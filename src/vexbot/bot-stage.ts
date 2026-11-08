// Ported from the public Vexora website's Vexbot renderer (src/lib/bot-stage.ts). Geometry, camera
// framing, lighting rig and pose layering are unchanged; only the accent is the portal's purple instead
// of the website's lime. The GLB is the website's exact file, served by this portal from /bot/.
// Only ever imported dynamically, so Three.js stays out of the bundle until the character is needed.
import { AdditiveBlending, BoxGeometry, CanvasTexture, Color, DirectionalLight, Euler, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, NeutralToneMapping, PerspectiveCamera, PMREMGenerator, Quaternion, Scene, Sprite, SpriteMaterial, SRGBColorSpace, Vector3, WebGLRenderer, type Object3D } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { BotAnimator } from "./bot-animator.ts";

export const BOT_URL = "/bot/vexora-bot.glb";

// The portal accent (#7561ce) lifted for emission, so the eyes and chest still read as light on metal.
export const BOT_ACCENT = { emissive: "#8f78ff", base: "#2b2163", light: 0x9a86f0, glow: "143,120,255" };
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

/** Recolours the GLB's glow materials to the portal purple. Exported so tests can check it on the real file. */
export function tintPurple(root: Object3D) {
  const tinted: string[] = [];
  root.traverse(object => {
    const mesh = object as Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) if (material instanceof MeshStandardMaterial && GLOW_MATERIALS.has(material.name)) {
      material.emissive.set(BOT_ACCENT.emissive); material.color.set(BOT_ACCENT.base);
      if (!tinted.includes(material.name)) tinted.push(material.name);
    }
  });
  return tinted;
}

export async function createBotStage(canvas: HTMLCanvasElement, url = BOT_URL): Promise<BotStage> {
  const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "low-power" });
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = NeutralToneMapping;
  renderer.toneMappingExposure = 1.05;

  const gltf = await new GLTFLoader().loadAsync(url);
  // Each stage owns a fresh GLTF instance, so the tint never leaks between stages.
  tintPurple(gltf.scene);
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

