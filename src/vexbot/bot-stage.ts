// Articulated website GLB with the portal reference's white shell, cyan lighting and round eyes.
// Animation hierarchy, gait, camera framing and flight contracts remain unchanged.
// Only ever imported dynamically, so Three.js stays out of the bundle until the character is needed.
import { AdditiveBlending, BoxGeometry, CanvasTexture, Color, DirectionalLight, Euler, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, NeutralToneMapping, PerspectiveCamera, PMREMGenerator, Quaternion, Scene, Sprite, SpriteMaterial, SRGBColorSpace, Vector3, WebGLRenderer, type Object3D } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { CatmullRomCurve3, Shape, ShapeGeometry, SphereGeometry, TorusGeometry, TubeGeometry } from 'three';
import { BotAnimator } from "./bot-animator.ts";

export const BOT_URL = "/bot/vexora-bot.glb";

export const BOT_ACCENT = { emissive: "#21d9ff", base: "#067aaf", light: 0x54dfff, glow: "33,217,255" };
// The GLB's two glowing materials. Everything else (gunmetal, graphite, polymer, visor) is untouched.
const GLOW_MATERIALS = new Set(["LimeGlow", "EyeGlow"]);

// The camera frames this many metres vertically at the character's plane, with the floor at
// FLOOR_METRES above the frame's lower edge. Movement code uses both to convert metres to pixels.
export const VIEW_HEIGHT_METRES = 2.2;
export const FLOOR_METRES = 0.12;
export const CANVAS_ASPECT = 0.82;
const CAMERA_FOV = 20;
const TILT_PIVOT_METRES = 0.92;
const LEG_BONE_METRES = 0.31;

// Radians added to each joint in the air. `x` swings a limb backward, `dive` adds to it at full dive, `z` swings
// a left limb outward (right limbs are negative), and `crouch` multiplies the landing knee bend.
const FLYING_POSE: Record<string, { x: number; dive?: number; z?: number; crouch?: number }> = {
  UpperArm_L: { x: 0.3, dive: 0.5, z: 0.32 },
  UpperArm_R: { x: 0.3, dive: 0.5, z: -0.32 },
  Forearm_L: { x: -0.2 },
  Forearm_R: { x: -0.2 },
  Thigh_L: { x: 0.14, dive: 0.28, crouch: -1 },
  Thigh_R: { x: 0.32, dive: 0.28, crouch: -1 },
  Shin_L: { x: 0.34, dive: 0.1, crouch: 2 },
  Shin_R: { x: 0.74, dive: 0.1, crouch: 2 },
  Foot_L: { x: 0.2, crouch: -1 },
  Foot_R: { x: 0.28, crouch: -1 },
  Head: { x: -0.08, dive: -0.45 },
};

export type BotMeta = { height: number; walkSpeed: number; turnYaw: number; seat: { y: number; z: number } };

export type BotStage = {
  animator: BotAnimator;
  meta: BotMeta;
  /** Rotation about the vertical axis; 0 faces the viewer, positive turns toward the character's left (screen right). */
  yaw: number;
  setSize(width: number, height: number): void;
  setSeatVisible(visible: boolean): void;
  /** Flight: `pitch` leans toward the viewer, `bank` rolls on screen, `air` blends the flying pose in, and `crouch` bends the knees. */
  setAttitude(pitch: number, bank: number, air: number, crouch: number): void;
  /** Renders one frame. `delta` is in seconds and advances animation. */
  frame(delta: number): void;
  inspect(): { clips: string[]; nodes: string[]; materials: Record<string, { metalness: number; roughness: number; emissive: string; emissiveIntensity: number }>; triangles: number; meshes: number };
  dispose(): void;
};

// A small softbox room built in code, which gives the metal its reflections without an HDRI download.
function studio() {
  const room = new Scene();
  room.background = new Color(0x34373a);
  const panel = (color: number, intensity: number, size: [number, number, number], at: [number, number, number]) => {
    const mesh = new Mesh(new BoxGeometry(...size), new MeshBasicMaterial({ color: new Color(color).multiplyScalar(intensity) }));
    mesh.position.set(...at);
    mesh.lookAt(0, 0, 0);
    room.add(mesh);
  };
  panel(0xffffff, 6, [8, 9, 0.1], [-7, 5, 6]);
  panel(0xe6ebee, 3, [6, 8, 0.1], [8, 3, 5]);
  panel(0xffffff, 4, [10, 4, 0.1], [0, 10, 1]);
  panel(BOT_ACCENT.light, 1.6, [2, 8, 0.1], [7, 1, -8]);
  panel(BOT_ACCENT.light, 1.2, [2, 8, 0.1], [-7, 1, -8]);
  panel(0x1a1c1b, 1, [20, 1, 20], [0, -6, 0]);
  return room;
}

function softDisc(inner: string, outer: string) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const context = canvas.getContext("2d")!;
  const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, inner);
  gradient.addColorStop(1, outer);
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/** Apply the reference finish without changing any animated joint, mesh extent or source GLB. */
export function styleReferenceBot(root: Object3D) {
  const tinted: string[] = [];
  root.traverse(object => {
    const mesh = object as Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (let index = 0; index < materials.length; index++) {
      let material = materials[index];
      if (!(material instanceof MeshStandardMaterial)) continue;
      if (GLOW_MATERIALS.has(material.name)) {
        material.emissive.set(BOT_ACCENT.emissive); material.color.set(BOT_ACCENT.base);
        if (!tinted.includes(material.name)) tinted.push(material.name);
      } else if (material.name === 'Gunmetal') {
        material.color.set('#edf4ff'); material.metalness = .28; material.roughness = .24;
      } else if (material.name === 'Graphite' && mesh.parent?.name === 'Head') {
        // This material is also used at joints: give only the helmet its own porcelain finish.
        const helmet = material.clone(); helmet.name = 'HelmetWhite';
        helmet.color.set('#e1edff'); helmet.metalness = .22; helmet.roughness = .22;
        materials[index] = helmet;
        mesh.material = Array.isArray(mesh.material) ? materials : helmet;
      }
    }
  });
  return tinted;
}

/** Small 3D additions follow the existing eye blink joints; no separate animation loop or texture download. */
function referenceFeatures(root: Object3D) {
  const cyan = new MeshStandardMaterial({ color: '#21d9ff', emissive: '#03b8ed', emissiveIntensity: 1.5, metalness: .15, roughness: .2 });
  const black = new MeshStandardMaterial({ color: '#01111e', roughness: .1, metalness: .3 });
  const white = new MeshBasicMaterial({ color: '#efffff' });
  for (const name of ['Eye_L', 'Eye_R']) {
    const eye = root.getObjectByName(name);
    if (!eye) continue;
    for (const child of eye.children) if ((child as Mesh).isMesh) child.visible = false;
    const iris = new Mesh(new SphereGeometry(.039, 24, 16), cyan);
    iris.scale.set(1, 1.15, .22); iris.position.z = .009; eye.add(iris);
    const pupil = new Mesh(new SphereGeometry(.022, 20, 12), black);
    pupil.scale.set(1, 1.15, .22); pupil.position.set(.003, 0, .018); eye.add(pupil);
    const shine = new Mesh(new SphereGeometry(.007, 10, 8), white);
    shine.scale.z = .2; shine.position.set(-.009, .017, .024); eye.add(shine);
  }
  const head = root.getObjectByName('Head');
  if (head) {
    const curve = new CatmullRomCurve3([new Vector3(-.043, .119, .202), new Vector3(0, .1, .214), new Vector3(.043, .119, .202)]);
    head.add(new Mesh(new TubeGeometry(curve, 20, .0035, 6, false), cyan));
    for (const side of [-1, 1]) {
      const ring = new Mesh(new TorusGeometry(.049, .004, 8, 40), cyan);
      ring.rotation.y = Math.PI / 2; ring.position.set(side * .23, .178, 0); head.add(ring);
    }
    // Enlarge the face within the original head's vertical envelope; blink tracks still own Eye_L/R.
    const shell = new Group(); shell.name = 'ReferenceHelmet';
    const parts = [...head.children];
    head.add(shell); shell.scale.setScalar(1.22); shell.position.y = -.081;
    parts.forEach(part => shell.add(part));
  }
  const chest = root.getObjectByName('Chest');
  if (chest) {
    const badge = new Mesh(new BoxGeometry(.18, .16, .006), new MeshStandardMaterial({ color: '#edf4ff', metalness: .28, roughness: .24 }));
    badge.position.set(0, .157, .145); chest.add(badge);
    const triangle = (points: [number, number][], color: string) => {
      const shape = new Shape(); shape.moveTo(...points[0]); points.slice(1).forEach(point => shape.lineTo(...point)); shape.closePath();
      const mesh = new Mesh(new ShapeGeometry(shape), new MeshStandardMaterial({ color, emissive: color, emissiveIntensity: .25, roughness: .25 }));
      mesh.position.set(0, .157, .15); chest.add(mesh);
    };
    triangle([[-.065, .045], [-.01, .028], [.02, -.052]], '#13c6ff');
    triangle([[.065, .045], [.026, -.027], [0, .013]], '#794bff');
  }
}

export async function createBotStage(canvas: HTMLCanvasElement, url = BOT_URL): Promise<BotStage> {
  const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "low-power" });
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = NeutralToneMapping;
  renderer.toneMappingExposure = 1.05;

  const gltf = await new GLTFLoader().loadAsync(url);
  // Each stage owns a fresh GLTF instance, so the tint never leaks between stages.
  styleReferenceBot(gltf.scene);
  referenceFeatures(gltf.scene);
  const scene = new Scene();
  const pmrem = new PMREMGenerator(renderer);
  const room = studio();
  const environment = pmrem.fromScene(room, 0.03).texture;
  scene.environment = environment;
  scene.environmentIntensity = 1;
  pmrem.dispose();

  const camera = new PerspectiveCamera(CAMERA_FOV, CANVAS_ASPECT, 0.1, 40);
  const distance = VIEW_HEIGHT_METRES / 2 / Math.tan((CAMERA_FOV * Math.PI) / 360);
  const centre = VIEW_HEIGHT_METRES / 2 - FLOOR_METRES;
  camera.position.set(0, centre + 0.12, distance);
  camera.lookAt(new Vector3(0, centre, 0));

  const key = new DirectionalLight(0xffffff, 1.3);
  key.position.set(-2.4, 3.4, 4);
  const rim = new DirectionalLight(BOT_ACCENT.light, 1);
  rim.position.set(2.6, 1.6, -3);
  const fill = new DirectionalLight(0xbfd0d6, 0.45);
  fill.position.set(3, 0.6, 3);
  scene.add(key, rim, fill);

  const holder = new Group();
  holder.add(gltf.scene);
  // Flight leans the whole figure around its middle, which keeps it inside the frame at any angle.
  const tilt = new Group();
  tilt.position.y = TILT_PIVOT_METRES;
  tilt.rotation.order = "ZXY";
  holder.position.y = -TILT_PIVOT_METRES;
  tilt.add(holder);
  scene.add(tilt);
  const root = gltf.scene.getObjectByName("Root") as Object3D;
  const meta = root.userData.vexoraBot as BotMeta;

  // Bloom would need a full post-processing pass, so soft additive sprites fake the glow instead.
  const glowMap = softDisc(`rgba(${BOT_ACCENT.glow},1)`, `rgba(${BOT_ACCENT.glow},0)`);
  const glow = (parent: Object3D | undefined, size: number, opacity: number, offset: [number, number, number] = [0, 0, 0]) => {
    if (!parent) return;
    const sprite = new Sprite(new SpriteMaterial({ map: glowMap, blending: AdditiveBlending, transparent: true, opacity, depthWrite: false, depthTest: false }));
    sprite.scale.setScalar(size);
    sprite.position.set(...offset);
    parent.add(sprite);
  };
  glow(gltf.scene.getObjectByName("Eye_L"), 0.13, 0.2);
  glow(gltf.scene.getObjectByName("Eye_R"), 0.13, 0.2);
  glow(gltf.scene.getObjectByName("Chest"), 0.22, 0.16, [0, 0.16, 0.14]);

  const groundMaterial = new MeshBasicMaterial({ map: softDisc(`rgba(${BOT_ACCENT.glow},.3)`, `rgba(${BOT_ACCENT.glow},0)`), transparent: true, depthWrite: false, blending: AdditiveBlending });
  const ground = new Mesh(new BoxGeometry(1, 0.001, 1), groundMaterial);
  ground.scale.set(1.15, 1, 0.75);
  ground.position.y = 0.001;
  holder.add(ground);

  // A plain ledge for SeatedIdle, shown only while sitting, so the character never sits on air.
  const seat = new Mesh(new BoxGeometry(0.54, meta.seat.y, 0.44), new MeshStandardMaterial({ color: 0x151917, metalness: 0.7, roughness: 0.42 }));
  seat.position.set(0, meta.seat.y / 2, meta.seat.z - 0.03);
  seat.visible = false;
  holder.add(seat);

  const animator = new BotAnimator(root, gltf.animations);

  // The clips have no flying pose, so one is layered on top of them each frame. The mixer only writes a
  // joint when its value changes, so each joint is put back first or the offsets would pile up.
  const posed = new Map<Object3D, Quaternion>();
  for (const name of Object.keys(FLYING_POSE)) {
    const joint = gltf.scene.getObjectByName(name);
    if (joint) posed.set(joint, joint.quaternion.clone());
  }
  const hips = gltf.scene.getObjectByName("Hips");
  const hipsRest = hips?.position.clone() ?? new Vector3();
  const offset = new Quaternion(), offsetAngles = new Euler();
  const attitude = { pitch: 0, bank: 0, air: 0, crouch: 0 };
  let layered = false;
  const liftLayer = () => {
    if (!layered) return;
    for (const [joint, base] of posed) joint.quaternion.copy(base);
    hips?.position.copy(hipsRest);
    layered = false;
  };
  const layerPose = () => {
    const { air, crouch } = attitude;
    const dive = Math.max(0, Math.min(1, attitude.pitch / 0.95));
    for (const [joint, base] of posed) base.copy(joint.quaternion);
    hipsRest.copy(hips?.position ?? hipsRest);
    for (const [joint] of posed) {
      const pose = FLYING_POSE[joint.name];
      const knee = crouch * (pose.crouch ?? 0);
      offsetAngles.set((pose.x + (pose.dive ?? 0) * dive) * air + knee, 0, (pose.z ?? 0) * air);
      joint.quaternion.multiply(offset.setFromEuler(offsetAngles));
    }
    // Two thigh-length bones bent by the same angle lower the hips by this much, keeping the feet on the floor.
    if (hips) hips.position.y -= 2 * LEG_BONE_METRES * (1 - Math.cos(crouch));
    layered = true;
  };

  const stage: BotStage = {
    animator,
    meta,
    yaw: 0,
    setSize(width, height) {
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(width, height, false);
    },
    setSeatVisible(visible) { seat.visible = visible; },
    setAttitude(pitch, bank, air, crouch) {
      attitude.pitch = pitch; attitude.bank = bank; attitude.air = air; attitude.crouch = crouch;
    },
    frame(delta) {
      liftLayer();
      animator.update(delta);
      holder.rotation.y = stage.yaw;
      tilt.rotation.x = attitude.pitch;
      tilt.rotation.z = attitude.bank;
      if (attitude.air > 0 || attitude.crouch > 0) layerPose();
      // The glow on the floor belongs to the floor, so it fades as the feet leave it.
      groundMaterial.opacity = 1 - attitude.air;
      ground.visible = attitude.air < 0.98;
      renderer.render(scene, camera);
    },
    inspect() {
      const nodes: string[] = [];
      const materials: ReturnType<BotStage["inspect"]>["materials"] = {};
      let triangles = 0, meshes = 0;
      gltf.scene.traverse(object => {
        if (object.name) nodes.push(object.name);
        const mesh = object as Mesh;
        if (!mesh.isMesh) return;
        meshes++;
        triangles += (mesh.geometry.index?.count ?? 0) / 3;
        const material = mesh.material as MeshStandardMaterial;
        if (!(material instanceof MeshStandardMaterial)) return;
        materials[material.name] = { metalness: material.metalness, roughness: material.roughness, emissive: `#${material.emissive.getHexString()}`, emissiveIntensity: material.emissiveIntensity };
      });
      return { clips: gltf.animations.map(clip => clip.name), nodes, materials, triangles, meshes };
    },
    dispose() {
      animator.mixer.stopAllAction();
      scene.traverse(object => {
        const mesh = object as Mesh;
        mesh.geometry?.dispose?.();
        const material = mesh.material as MeshStandardMaterial | undefined;
        material?.map?.dispose();
        material?.dispose?.();
      });
      environment.dispose();
      room.traverse(object => { (object as Mesh).geometry?.dispose?.(); ((object as Mesh).material as MeshBasicMaterial | undefined)?.dispose?.(); });
      renderer.dispose();
    },
  };
  return stage;
}

