// Vexbot motion tests ported from the public Vexora website (tests/companion.test.mjs, robot and movement
// sections). They run against the portal's copies of the original modules and the exact GLB file.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import test from "node:test";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { BotAnimator } from "../src/vexbot/bot-animator.ts";
import { CompanionDirector } from "../src/vexbot/companion/director.ts";
import { corridor, cruiseScale, flightScale, flightZone, openBand, ScrollWatch } from "../src/vexbot/companion/flight.ts";
import { chooseDock, freeColumns, isClear, overlaps, silhouette } from "../src/vexbot/companion/safe-layout.ts";

const bytes = await readFile("public/bot/vexora-bot.glb");
const loadBot = () => new Promise((resolve, reject) => new GLTFLoader().parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "", resolve, reject));
const REQUIRED = ["Idle", "Walk", "TurnLeft", "TurnRight", "Wave", "SitDown", "SeatedIdle", "StandUp", "Listen", "Think", "Speak", "Present"];
const world = (scene, name) => { scene.updateMatrixWorld(true); return new THREE.Vector3().setFromMatrixPosition(scene.getObjectByName(name).matrixWorld); };

test("the GLB is the website's exact file", () => {
  assert.equal(createHash("sha256").update(bytes).digest("hex"), "f1c9a5420e701051db67788f6e762502175aec69112298ee38a701e3665c45bc");
});

test("the GLB is light enough for a portal companion", () => assert.ok(bytes.length < 900 * 1024, `${bytes.length} bytes`));

test("the loader returns every required clip and a full articulated hierarchy", async () => {
  const gltf = await loadBot();
  const names = gltf.animations.map(clip => clip.name);
  for (const clip of REQUIRED) assert.ok(names.includes(clip), clip);
  for (const joint of ["Root", "Hips", "Spine", "Chest", "Neck", "Head", "Eye_L", "Eye_R", "Shoulder_L", "UpperArm_R", "Forearm_L", "Hand_R", "Index2_L", "Thumb2_R", "Thigh_L", "Shin_R", "Foot_L", "Toe_R"]) assert.ok(gltf.scene.getObjectByName(joint), joint);
  const meta = gltf.scene.getObjectByName("Root").userData.vexoraBot;
  assert.ok(meta.walkSpeed > 0.3 && meta.walkSpeed < 1.5, "walking speed is published for movement code");
  assert.ok(meta.approximationOf.includes("character.png"));
});

test("Walk is an in-place cycle: Root never moves and the loop closes", async () => {
  const gltf = await loadBot();
  const walk = gltf.animations.find(clip => clip.name === "Walk");
  assert.equal(walk.tracks.some(track => track.name === "Root.position"), false);
  const rootRotation = walk.tracks.find(track => track.name === "Root.quaternion");
  if (rootRotation) for (let i = 0; i < rootRotation.values.length; i += 4) assert.ok(Math.abs(rootRotation.values[i + 3]) > 0.9999);
  const mixer = new THREE.AnimationMixer(gltf.scene);
  mixer.clipAction(walk).play();
  mixer.setTime(0);
  const start = world(gltf.scene, "Foot_L");
  mixer.setTime(walk.duration - 1e-4);
  assert.ok(world(gltf.scene, "Foot_L").distanceTo(start) < 0.005);
});

test("a planted foot moves back at the published speed, so travel at that speed does not skate", async () => {
  const gltf = await loadBot();
  const walk = gltf.animations.find(clip => clip.name === "Walk");
  const { walkSpeed } = gltf.scene.getObjectByName("Root").userData.vexoraBot;
  const mixer = new THREE.AnimationMixer(gltf.scene);
  mixer.clipAction(walk).play();
  // Sampled in the flat-footed part of the stance, between heel roll and toe-off.
  const at = t => { mixer.setTime(t); return world(gltf.scene, "Foot_L").z; };
  const t0 = walk.duration * 0.2, t1 = walk.duration * 0.36;
  const speed = (at(t0) - at(t1)) / (t1 - t0);
  assert.ok(Math.abs(speed - walkSpeed) / walkSpeed < 0.05, `foot ${speed.toFixed(3)} vs published ${walkSpeed.toFixed(3)}`);
});

test("feet stay on or above the floor through every clip", async () => {
  const gltf = await loadBot();
  const mixer = new THREE.AnimationMixer(gltf.scene);
  for (const clip of gltf.animations) {
    mixer.stopAllAction();
    mixer.clipAction(clip).play();
    for (let t = 0; t <= clip.duration; t += clip.duration / 24) {
      mixer.setTime(t);
      for (const foot of ["Foot_L", "Foot_R"]) assert.ok(world(gltf.scene, foot).y > 0.1, `${clip.name} ${foot} at ${t.toFixed(2)}`);
    }
  }
});

test("joints are never over-subscribed while blending between clips and gestures", async () => {
  const gltf = await loadBot();
  const animator = new BotAnimator(gltf.scene, gltf.animations);
  const assertExclusive = label => { for (const [name, total] of animator.jointWeights()) assert.ok(Math.abs(total - 1) < 1e-6, `${label}: ${name} has weight ${total}`); };
  const run = (seconds, label) => { for (let t = 0; t < seconds; t += 1 / 30) { animator.update(1 / 30); assertExclusive(label); } };
  run(0.5, "idle");
  animator.request("Walk"); run(0.1, "into walk");
  animator.setGesture("Wave"); run(0.1, "wave fading over walk");
  animator.setGesture("Speak"); run(0.1, "gesture interrupted");
  run(0.6, "speak over walk");
  animator.setGesture(null); run(0.5, "gesture released");
  animator.request("SeatedIdle"); run(2.5, "sitting");
  assert.equal(animator.base, "SeatedIdle");
  animator.setGesture("Listen"); run(0.6, "listen seated");
  animator.setGesture(null); run(0.5, "release seated");
});

test("sitting and standing are routed automatically, and a Walk request waits for StandUp", async () => {
  const gltf = await loadBot();
  const animator = new BotAnimator(gltf.scene, gltf.animations);
  animator.request("SeatedIdle");
  assert.equal(animator.base, "SitDown");
  for (let t = 0; t < 1.7; t += 1 / 30) animator.update(1 / 30);
  assert.equal(animator.base, "SeatedIdle");
  assert.equal(animator.turn("TurnLeft"), false, "cannot turn while seated");
  animator.request("Walk");
  assert.equal(animator.base, "StandUp");
  for (let t = 0; t < 1.6; t += 1 / 30) animator.update(1 / 30);
  assert.equal(animator.base, "Walk");
});

test("a turn hands its yaw to the outer group with no visible jump", async () => {
  const gltf = await loadBot();
  const animator = new BotAnimator(gltf.scene, gltf.animations);
  const holder = new THREE.Group();
  holder.add(gltf.scene);
  animator.onTurnComplete = yaw => { holder.rotation.y += yaw; };
  for (let t = 0; t < 1; t += 1 / 30) animator.update(1 / 30);
  animator.turn("TurnLeft");
  const facing = () => { holder.updateMatrixWorld(true); return new THREE.Vector3(0, 0, 1).applyQuaternion(gltf.scene.getObjectByName("Root").getWorldQuaternion(new THREE.Quaternion())); };
  let previous = facing(), biggestStep = 0;
  for (let t = 0; t < 1.5; t += 1 / 30) { animator.update(1 / 30); const now = facing(); biggestStep = Math.max(biggestStep, now.angleTo(previous)); previous = now; }
  assert.ok(Math.abs(holder.rotation.y - Math.PI / 2) < 1e-6);
  assert.ok(biggestStep < 0.2, `largest per-frame rotation ${biggestStep.toFixed(3)} rad`);
  assert.equal(animator.base, "Idle");
});

function fakeStage() {
  const calls = [];
  const state = { base: "Idle", gesture: null, seated: false, busy: false };
  return {
    calls, state, meta: { walkSpeed: 0.65 }, yaw: 0, seat: false,
    setSeatVisible(visible) { this.seat = visible; },
    setAttitude(pitch, bank, air, crouch) { this.attitude = { pitch, bank, air, crouch }; },
    animator: {
      get isBusy() { return state.busy; }, get posture() { return state.seated ? "seated" : "standing"; },
      resume() {}, request(name) { state.base = name; calls.push(name); if (name === "SeatedIdle") state.seated = true; if (name !== "SeatedIdle") state.seated = false; },
      turn(name) { calls.push(name); return true; }, setGesture(name) { state.gesture = name; calls.push(`gesture:${name}`); }, setWalkRate(rate) { state.rate = rate; }, pose(name) { calls.push(`pose:${name}`); },
    },
  };
}
const place = (key, x, extra = {}) => ({ key, x, y: 500, scale: 0.5, rest: "stand", gesture: null, faceYaw: 0.3, ...extra });

test("the director walks to a new place at foot speed, then rests", () => {
  const stage = fakeStage();
  stage.onTurn = null;
  const director = new CompanionDirector(stage, 220);
  director.setTarget(place("a", 100));
  director.update(1 / 60);
  assert.equal(director.state, "resting");
  stage.yaw = Math.PI / 2; // Already facing the direction of travel.
  director.setTarget(place("b", 400));
  director.update(0.5); // Ramp the walk in.
  const before = director.x;
  director.update(0.1);
  assert.equal(stage.state.base, "Walk");
  const expected = director.footSpeed * stage.state.rate * 0.1;
  assert.ok(Math.abs(director.x - before - expected) < 0.001);
  for (let i = 0; i < 2000 && director.state !== "resting"; i++) director.update(1 / 60);
  assert.equal(director.x, 400);
  assert.equal(director.state, "resting");
  director.update(1 / 60);
  assert.ok(stage.calls.includes("TurnRight"), "turns back toward the viewer on arrival");
  stage.yaw = 0.3;
  director.update(1 / 60);
  assert.equal(stage.state.base, "Idle");
});

test("the director turns before walking when facing the wrong way", () => {
  const stage = fakeStage();
  const director = new CompanionDirector(stage, 220);
  director.setTarget(place("a", 100));
  director.setTarget(place("b", 400));
  director.update(1 / 60);
  assert.ok(stage.calls.includes("TurnLeft"), "toward screen right is the character's left");
  assert.ok(!stage.calls.includes("Walk"));
  assert.equal(director.x, 100, "no travel during the turn");
});

test("a resting character rides along with its place instead of walking when the page scrolls", () => {
  const stage = fakeStage();
  const director = new CompanionDirector(stage, 220);
  director.setTarget(place("hero", 300));
  director.update(1 / 60);
  director.setTarget({ ...place("hero", 300), y: 200 });
  director.update(1 / 60);
  assert.equal(director.y, 200);
  assert.ok(!stage.calls.includes("Walk"));
});

test("the open conversation is entered and left directly, so the character never walks behind it", () => {
  const stage = fakeStage();
  const director = new CompanionDirector(stage, 220);
  director.setTarget(place("floor", 60));
  director.setTarget(place("panel", 300, { instant: true }));
  assert.equal(director.x, 300);
  assert.equal(director.state, "resting");
  director.setTarget(place("floor", 60));
  assert.equal(director.x, 60);
  assert.equal(director.state, "resting");
});

test("attention gestures override place gestures, and reduced motion never walks", () => {
  const stage = fakeStage();
  const director = new CompanionDirector(stage, 220);
  director.setTarget(place("a", 100));
  director.setAttention("Listen");
  director.update(1 / 60);
  assert.equal(stage.state.gesture, "Listen");
  const calm = fakeStage();
  const frozen = new CompanionDirector(calm, 220);
  frozen.frozen = true;
  frozen.setTarget(place("a", 100));
  frozen.setTarget(place("b", 900));
  frozen.update(1 / 60);
  assert.equal(frozen.x, 900);
  assert.ok(!calm.calls.includes("Walk"));
  assert.ok(calm.calls.includes("pose:Idle"));
});

const SKY = { viewportWidth: 1440, viewportHeight: 900, scan: { flow: [], pinned: [{ left: 0, right: 1440, top: 0, bottom: 60 }], freeLeft: 100, freeRight: 100 }, controls: { left: 10, right: 90, top: 780, bottom: 888 }, allowed: true };
const FRAME = 1 / 60;
// Advances the character, scrolling the page by `speed` pixels a second, and records every frame.
function flyFor(director, seconds, scroll, speed = 0, frames = []) {
  for (let t = 0; t < seconds; t += FRAME) {
    scroll.y += speed * FRAME;
    director.setAirspace({ ...SKY, scrollY: scroll.y });
    director.update(FRAME);
    frames.push({ x: director.x, y: director.y, ppm: director.scale * 220, scroll: scroll.y, phase: director.flightPhase, pitch: director.pitch, bank: director.bank });
  }
  return frames;
}
// The column beside SKY's content is 100 pixels wide, and this resting figure fits in it.
const flyer = (spot = place("rest", 50, { y: 770, scale: 0.26 })) => {
  const stage = fakeStage(), director = new CompanionDirector(stage, 220), scroll = { y: 2000 };
  director.setTarget(spot);
  flyFor(director, 0.1, scroll);
  return { stage, director, scroll, spot };
};
const biggestStep = frames => frames.slice(1).reduce((most, frame, i) => Math.max(most, Math.hypot(frame.x - frames[i].x, frame.y - frames[i].y)), 0);
// The flying figure's box, as flight.ts allows for it, in viewport pixels.
const flyingBox = frame => ({ left: frame.x - 0.66 * frame.ppm, right: frame.x + 0.66 * frame.ppm, top: frame.y - 1.78 * frame.ppm, bottom: frame.y + 0.1 * frame.ppm });

test("scroll watch: tiny shifts and a single wheel click don't count, and scrolling ends after a settling delay of 250-400ms", () => {
  const watch = new ScrollWatch();
  let y = 0;
  for (let i = 0; i < 4; i++) { y += 3; watch.update(y, FRAME); }
  assert.equal(watch.scrolling, false, "12 pixels isn't scrolling");
  const click = new ScrollWatch();
  for (let i = 0; i < 6; i++) click.update(i * 100 / 6, FRAME);
  click.update(100, FRAME);
  assert.equal(click.scrolling, false, "one 100 pixel wheel click isn't enough to take off for");
  const jumped = new ScrollWatch();
  jumped.update(1260, FRAME);
  jumped.update(1284, FRAME);
  jumped.update(1284, FRAME);
  assert.equal(jumped.scrolling, false, "a one-frame correction from content changing height isn't scrolling");
  for (let i = 0; i < 15; i++) { y += 10; watch.update(y, FRAME); }
  assert.equal(watch.scrolling, true);
  assert.equal(watch.direction, 1);
  assert.ok(watch.speed > 0);
  let still = 0;
  while (watch.scrolling) { watch.update(y, FRAME); still += FRAME; }
  assert.ok(still >= 0.25 && still <= 0.4, `settled after ${still}`);
  watch.update(y - 40, FRAME);
  assert.equal(watch.direction, -1);
});

test("the whole cycle: idle, takeoff, cruise, approach, touchdown, idle, landing exactly on the spot", () => {
  const { stage, director, scroll, spot } = flyer();
  assert.equal(director.state, "resting");
  const flying = flyFor(director, 2, scroll, 1200);
  assert.equal(director.state, "travelling");
  const seen = new Set(flying.map(frame => frame.phase));
  assert.ok(seen.has("takeoff") && seen.has("cruise"), [...seen].join());
  const lifted = flying.findIndex(frame => frame.phase !== "grounded");
  assert.ok(lifted <= 7, `takes off within about a tenth of a second of the page really moving, not ${lifted} frames`);
  assert.equal(flying[lifted].phase, "takeoff");
  assert.ok(Math.hypot(flying[lifted + 5].x - spot.x, flying[lifted + 5].y - spot.y) < 8, "a takeoff starts gently");
  assert.ok(stage.attitude.air > 0.5, "the flying pose has blended in");
  const landing = flyFor(director, 8, scroll, 0);
  const order = landing.map(frame => frame.phase).filter((phase, i, all) => phase !== all[i - 1]);
  assert.deepEqual(order, ["cruise", "approach", "touchdown", "grounded"]);
  assert.equal(director.x, spot.x);
  assert.equal(director.y, spot.y);
  assert.equal(director.state, "resting");
  assert.deepEqual(stage.attitude, { pitch: 0, bank: 0, air: 0, crouch: 0 });
  assert.equal(stage.state.base, "Idle");
  assert.ok(!stage.calls.includes("Walk"));
  const again = flyFor(director, 1, scroll, 800);
  assert.ok(again.some(frame => frame.phase === "takeoff"), "and it repeats on the next scroll");
});

test("landing waits for the settling delay before it begins", () => {
  const { director, scroll } = flyer();
  flyFor(director, 1.5, scroll, 1000);
  const frames = flyFor(director, 1, scroll, 0);
  const seconds = frames.findIndex(frame => frame.phase === "approach") * FRAME;
  assert.ok(seconds >= 0.25 && seconds <= 0.4, `began after ${seconds}`);
});

test("scrolling during a landing returns to flight with no jump, at every stage of it", () => {
  for (const landingFor of [0.4, 0.8, 1.2, 1.6, 2, 2.4, 2.8, 3.2]) {
    const { director, scroll } = flyer();
    const frames = flyFor(director, 1.2, scroll, 1000);
    flyFor(director, landingFor, scroll, 0, frames);
    flyFor(director, 1, scroll, 1000, frames);
    assert.ok(biggestStep(frames) < 1000 * 1.1 * FRAME + 8, `largest step ${biggestStep(frames)} at ${landingFor}`);
    assert.equal(frames.at(-1).phase === "cruise" || frames.at(-1).phase === "takeoff", true);
  }
});

test("rapid, repeated and reversed scrolling never makes it jump", () => {
  const { director, scroll } = flyer();
  const frames = [];
  for (let burst = 0; burst < 30; burst++) {
    flyFor(director, 0.05 + (burst % 7) * 0.06, scroll, burst % 2 ? 3500 : -3500, frames);
    flyFor(director, (burst % 5) * 0.09, scroll, 0, frames);
  }
  assert.ok(biggestStep(frames) < 1100 * 1.3 * FRAME + 8, `largest step ${biggestStep(frames)}`);
  flyFor(director, 8, scroll, 0, frames);
  assert.equal(director.state, "resting");
});

test("it dives more for a fast scroll than for a slow one, and leans back flying up", () => {
  const deepest = speed => { const { director, scroll } = flyer(); return flyFor(director, 5, scroll, speed).reduce((most, frame) => Math.max(most, frame.pitch), 0); };
  const slow = deepest(120), fast = deepest(3000);
  assert.ok(fast > slow * 1.5, `slow ${slow}, fast ${fast}`);
  assert.ok(fast < 1.2, "a controlled dive, not a somersault");
  const { director, scroll } = flyer();
  assert.ok(flyFor(director, 3, scroll, -2000).some(frame => frame.pitch < -0.05), "scrolling up also flies up");
});

test("scrolling, it flies inside the clear column beside the content, under the header and above the controls, rising and falling", () => {
  for (const speed of [400, 1200, 3500, -1200]) {
    const { director, scroll } = flyer();
    const frames = flyFor(director, 4, scroll, speed);
    const flying = frames.filter(frame => frame.phase === "cruise");
    assert.ok(flying.length > 100, `cruised at ${speed}`);
    for (const frame of frames.filter(frame => frame.phase !== "grounded")) {
      const box = flyingBox(frame);
      assert.ok(box.left >= 0 && box.right <= 100, `inside the column at ${speed}: ${box.left}-${box.right}`);
      assert.ok(box.top >= 60, `head under the header at ${speed}: ${box.top}`);
      assert.ok(box.bottom <= 780, `feet above the controls at ${speed}: ${box.bottom}`);
    }
    const heights = flying.slice(40).map(frame => frame.y);
    assert.ok(Math.max(...heights) - Math.min(...heights) > 8, "it rises and falls a little rather than hanging still");
    assert.ok(Math.max(...heights) - Math.min(...heights) < 120, "but doesn't bounce");
  }
  const up = flyer(), down = flyer();
  const mean = frames => frames.slice(-60).reduce((sum, frame) => sum + frame.y, 0) / 60;
  assert.ok(mean(flyFor(up.director, 3, up.scroll, -1200)) < mean(flyFor(down.director, 3, down.scroll, 1200)) - 60, "scrolling up it climbs higher");
});

test("the flight strip, its zone, its size and the open band are measured from the content", () => {
  const strip = corridor(SKY, { x: 50 });
  assert.deepEqual(strip, { left: 0, right: 100, top: 60, bottom: 780, bar: false });
  const consent = { left: 989, right: 1409, top: 660, bottom: 824 };
  assert.equal(corridor({ ...SKY, scan: { ...SKY.scan, pinned: [...SKY.scan.pinned, consent] } }, { x: 50 }).top, 60, "a banner pinned low down isn't mistaken for the header");
  const zone = flightZone(strip, 60);
  assert.ok(zone.left - 0.66 * 60 >= 8 && zone.right + 0.66 * 60 <= 92, "the whole flying figure stays inside, with the margin");
  assert.ok(zone.top - 1.78 * 60 >= 68 && zone.bottom + 0.1 * 60 <= 772);
  const fitted = flightScale(strip, 0.5, 220, 1440) * 220;
  assert.ok(fitted * 0.66 * 2 + 16 <= 100, `shrinks to fit the column: ${fitted} pixels a metre`);
  assert.equal(Math.round(flightScale(corridor({ ...SKY, scan: { ...SKY.scan, freeLeft: 300 } }, { x: 150 }), 0.5, 220, 1440) * 220 * 1.72), 165, "a wide column keeps the usual flight size");
  const bar = corridor({ ...SKY, controls: { left: 0, right: 1440, top: 828, bottom: 900 } }, { x: 27 });
  assert.deepEqual(bar, { left: 0, right: 54, top: 828, bottom: 900, bar: true });
  const barZone = flightZone(bar, 0.75 * 34);
  assert.ok(barZone.top - 1.78 * 0.75 * 34 >= 828, "in the bar, the head stays in the bar");
  assert.ok(barZone.bottom - barZone.top > 8, "with room to lift off");
  const right = corridor({ ...SKY, scan: { ...SKY.scan, freeRight: 200 } }, { x: 1300 });
  assert.equal(right.left, 1240, "a landing on the right flies in the right column");
  const flow = [{ left: 100, right: 800, top: 300, bottom: 360 }, { left: 100, right: 1340, top: 850, bottom: 1600 }, { left: 900, right: 1300, top: 500, bottom: 700 }];
  assert.deepEqual(openBand(flow, 0, 500, 600, 700), { top: 368, bottom: 842 }, "between the buttons and the demo, ignoring what's off to the side");
  assert.deepEqual(openBand(flow, 0, 500, 320, 420), { top: 368, bottom: 842 }, "a figure the page has jumped into still gets the band it's mostly in");
  assert.equal(openBand([{ left: 0, right: 600, top: 300, bottom: 360 }, { left: 0, right: 600, top: 420, bottom: 500 }], 0, 500, 340, 440), null, "a gap too narrow for the figure isn't a band");
});

test("leaving the hero it slides sideways through the open band into the column, never over the demo below", () => {
  // Hero buttons above, the playing demo below, and the clear column at the left.
  const buttons = { left: 100, right: 800, top: 300, bottom: 360 }, demo = { left: 100, right: 1340, top: 850, bottom: 1600 };
  const sky = { ...SKY, controls: { left: 10, right: 90, top: 840, bottom: 888 }, scan: { ...SKY.scan, flow: [buttons, demo] } };
  for (const speed of [600, 1200, 2400, 5000]) {
    const stage = fakeStage(), director = new CompanionDirector(stage, 220);
    const hero = scroll => place("hero", 400, { y: 760 - scroll, scale: 0.6, anchored: true });
    const rest = place("/:dock", 50, { y: 830, scale: 0.26 });
    let scroll = 0;
    const frames = [];
    for (let t = 0; t < 5; t += FRAME) {
      if (t < 1.2) scroll += speed * FRAME;
      director.setTarget(scroll <= 60 ? hero(scroll) : rest);
      director.setAirspace({ ...sky, scrollY: scroll });
      director.update(FRAME);
      frames.push({ x: director.x, y: director.y, ppm: director.scale * 220, scroll, phase: director.flightPhase });
    }
    for (const frame of frames) {
      // Only what's on screen can cover anything. Very fast scrolls carry it just out of view at the top.
      const whole = flyingBox(frame), box = { ...whole, top: Math.max(0, whole.top), bottom: Math.min(900, whole.bottom) };
      if (box.bottom <= box.top) continue;
      const overDemo = box.right > demo.left && box.left < demo.right && box.bottom + frame.scroll > demo.top && box.top + frame.scroll < demo.bottom;
      assert.ok(!overDemo, `over the demo at ${speed}: x ${frame.x} y ${frame.y} scroll ${frame.scroll} ${frame.phase}`);
      const overButtons = box.right > buttons.left && box.left < buttons.right && box.bottom + frame.scroll > buttons.top && box.top + frame.scroll < buttons.bottom;
      assert.ok(!overButtons, `over the buttons at ${speed}`);
      assert.ok(frame.x <= 400 + 1, "it never heads out across the middle");
    }
    if (speed <= 1200) assert.ok(frames.every(frame => flyingBox(frame).top >= 60 - 1 || frame.phase === "grounded"), `stays on screen at ${speed}`);
    assert.equal(director.state, "resting");
    assert.equal(director.x, 50);
    assert.ok(biggestStep(frames) < 2400 * FRAME + 8, `no jumps: ${biggestStep(frames)}`);
  }
});

test("returning to the hero it levels with the spot in the column, then glides across, growing on the way", () => {
  const buttons = { left: 100, right: 800, top: 300, bottom: 360 }, demo = { left: 100, right: 1340, top: 850, bottom: 1600 };
  const sky = { ...SKY, controls: { left: 10, right: 90, top: 840, bottom: 888 }, scan: { ...SKY.scan, flow: [buttons, demo] } };
  const stage = fakeStage(), director = new CompanionDirector(stage, 220);
  director.setTarget(place("/:dock", 50, { y: 830, scale: 0.26 }));
  director.setAirspace({ ...sky, scrollY: 0 });
  director.update(FRAME);
  director.setTarget(place("hero", 400, { y: 760, scale: 0.6, anchored: true }));
  const frames = [];
  for (let t = 0; t < 6; t += FRAME) {
    director.setAirspace({ ...sky, scrollY: 0 });
    director.update(FRAME);
    frames.push({ x: director.x, y: director.y, ppm: director.scale * 220, scroll: 0, phase: director.flightPhase });
  }
  for (const frame of frames) {
    const box = flyingBox(frame);
    assert.ok(!(box.right > buttons.left && box.left < buttons.right && box.bottom > buttons.top && box.top < buttons.bottom), `over the buttons at ${frame.x},${frame.y}`);
    assert.ok(!(box.right > demo.left && box.bottom > demo.top), `over the demo at ${frame.x},${frame.y}`);
    if (frame.x < 60) assert.ok(frame.ppm < 0.35 * 220, "still small while in the column");
  }
  assert.equal(director.state, "resting");
  assert.equal(director.x, 400);
  assert.equal(director.y, 760);
});

test("with a reserved bar instead of a column, it lifts off and lands inside the bar", () => {
  const sky = { ...SKY, controls: { left: 0, right: 1440, top: 828, bottom: 900 } };
  const ppm = 60 / 1.79, spot = place("/:dock", 8 + 0.56 * ppm, { y: 900 - 0.07 * ppm - 4, scale: ppm / 220 });
  const stage = fakeStage(), director = new CompanionDirector(stage, 220);
  let scroll = 2000;
  const frames = [];
  director.setTarget(spot);
  for (let t = 0; t < 5; t += FRAME) {
    if (t < 2) scroll += 1500 * FRAME;
    director.setAirspace({ ...sky, scrollY: scroll });
    director.update(FRAME);
    frames.push({ x: director.x, y: director.y, ppm: director.scale * 220, phase: director.flightPhase });
  }
  const flying = frames.filter(frame => frame.phase !== "grounded");
  assert.ok(flying.some(frame => frame.phase === "cruise"), "it flies");
  assert.ok(Math.min(...flying.map(frame => frame.y)) < spot.y - 6, "and visibly lifts");
  for (const frame of flying) assert.ok(flyingBox(frame).top >= 828, `head inside the bar: ${flyingBox(frame).top}`);
  assert.equal(director.state, "resting");
});

test("the flight size shrinks a hero figure and enlarges a tiny bar one, within reason", () => {
  const pixels = (rest, width) => cruiseScale(rest / (220 * 1.72), 220, width) * 220 * 1.72;
  assert.equal(Math.round(pixels(380, 1440)), 165);
  assert.equal(Math.round(pixels(60, 1180)), 110);
  assert.equal(Math.round(pixels(60, 390)), 78);
  assert.equal(Math.round(pixels(130, 1440)), 130);
});

test("it stays grounded when flight isn't allowed, and comes down if that changes mid-flight", () => {
  const { director, scroll } = flyer();
  const update = (allowed, speed, seconds) => { for (let t = 0; t < seconds; t += FRAME) { scroll.y += speed * FRAME; director.setAirspace({ ...SKY, scrollY: scroll.y, allowed }); director.update(FRAME); } };
  update(false, 1000, 0.5);
  assert.equal(director.flightPhase, "grounded", "a conversation holds it still");
  update(true, 1000, 1);
  assert.notEqual(director.flightPhase, "grounded");
  update(false, 1000, 0.1);
  assert.equal(director.flightPhase, "approach");
  update(false, 1000, 8);
  assert.equal(director.state, "resting");
});

test("a small scroll carries an anchored character along; it only takes off once the place changes", () => {
  const hero = place("hero", 400, { y: 700, anchored: true });
  const { director, scroll } = flyer(hero);
  flyFor(director, 0.5, scroll, 100);
  assert.equal(director.flightPhase, "grounded");
  director.setTarget({ ...place("/:side", 60, { y: 770 }) });
  flyFor(director, 0.2, scroll, 100);
  assert.notEqual(director.flightPhase, "grounded");
});

test("a long move flies even without scrolling, and a short hop still walks", () => {
  const far = flyer();
  far.director.setTarget(place("other", 800, { y: 300 }));
  const frames = flyFor(far.director, 8, far.scroll);
  assert.equal(frames[0].phase, "takeoff");
  assert.equal(far.director.state, "resting");
  assert.equal(far.director.x, 800);
  const near = flyer();
  near.stage.yaw = Math.PI / 2;
  near.director.setTarget(place("next", 200, { y: 770 }));
  flyFor(near.director, 0.5, near.scroll);
  assert.equal(near.director.flightPhase, "grounded");
  assert.ok(near.stage.calls.includes("Walk"));
});

test("a seated character stands up before taking off, and sits again if the scroll ends first", () => {
  const seated = place("form", 60, { y: 770, rest: "sit" });
  const { stage, director, scroll } = flyer(seated);
  assert.equal(stage.state.base, "SeatedIdle");
  stage.state.busy = true;
  flyFor(director, 0.2, scroll, 800);
  assert.equal(director.flightPhase, "grounded", "still getting up");
  assert.equal(stage.state.base, "Idle");
  stage.state.busy = false;
  flyFor(director, 0.2, scroll, 800);
  assert.notEqual(director.flightPhase, "grounded");
});

test("reduced motion and the keep-still control never fly, and placing it directly ends a flight", () => {
  const calm = flyer();
  calm.director.frozen = true;
  assert.ok(flyFor(calm.director, 1, calm.scroll, 2000).every(frame => frame.phase === "grounded" && frame.x === 50));
  const still = flyer();
  still.director.still = true;
  assert.ok(flyFor(still.director, 1, still.scroll, 2000).every(frame => frame.phase === "grounded"));
  const midair = flyer();
  flyFor(midair.director, 1, midair.scroll, 1000);
  midair.director.still = true;
  flyFor(midair.director, FRAME, midair.scroll);
  assert.equal(midair.director.flightPhase, "grounded");
  assert.equal(midair.director.x, 50);
  assert.deepEqual(midair.stage.attitude, { pitch: 0, bank: 0, air: 0, crouch: 0 });
  const panel = flyer();
  flyFor(panel.director, 1, panel.scroll, 1000);
  panel.director.setTarget(place("panel", 1300, { y: 200, instant: true }));
  assert.equal(panel.director.flightPhase, "grounded");
  assert.equal(panel.director.x, 1300);
});

test("overlap geometry: margins and clear columns", () => {
  const box = { left: 100, right: 200, top: 100, bottom: 200 };
  assert.ok(overlaps(box, { left: 205, right: 300, top: 100, bottom: 200 }), "inside the margin");
  assert.ok(!overlaps(box, { left: 209, right: 300, top: 100, bottom: 200 }), "outside the margin");
  assert.deepEqual(freeColumns([{ left: 100, right: 1340, top: 0, bottom: 5000 }], [{ left: 120, right: 1300, top: 0, bottom: 60 }], 1440), { freeLeft: 100, freeRight: 100 });
  const scan = { flow: [{ left: 300, right: 500, top: 1000, bottom: 1100 }], pinned: [{ left: 0, right: 1440, top: 0, bottom: 60 }], freeLeft: 0, freeRight: 0 };
  assert.ok(isClear({ left: 300, right: 400, top: 200, bottom: 300 }, scan, 0), "the content is further down the page");
  assert.ok(!isClear({ left: 300, right: 400, top: 200, bottom: 300 }, scan, 800), "and arrives when scrolled");
  assert.ok(!isClear({ left: 300, right: 400, top: 40, bottom: 90 }, scan, 0), "the sticky header stays put");
});

test("the silhouette grows with a wide gesture and includes the feet", () => {
  const still = silhouette(100, 500, 100, "stand"), waving = silhouette(100, 500, 100, "stand", "Wave");
  assert.ok(waving.left < still.left && waving.right > still.right);
  assert.ok(still.bottom > 500, "feet reach below the floor point");
  assert.ok(still.top <= 500 - 172, "head");
});

test("a side column is used only when it's really clear; otherwise the reserved bar", () => {
  assert.deepEqual(chooseDock({ freeLeft: 100, freeRight: 100 }, 900), { kind: "gutter", side: "left", width: 100 });
  assert.deepEqual(chooseDock({ freeLeft: 12, freeRight: 300 }, 900), { kind: "gutter", side: "right", width: 300 });
  assert.deepEqual(chooseDock({ freeLeft: 40, freeRight: 40 }, 900), { kind: "bar" });
  assert.deepEqual(chooseDock({ freeLeft: 300, freeRight: 300 }, 500), { kind: "bar" }, "too short for a column");
});


// ---- Portal adaptation ----
import { choosePortalDock, perchStrip, stationTarget } from "../src/vexbot/companion/stations.ts";
import { Flight } from "../src/vexbot/companion/flight.ts";

const PPM = 486 / 2.2;
const perch = { left: 0, right: 233, top: 290, bottom: 720 };
const layout = (page, extra = {}) => ({ viewportWidth: 1440, viewportHeight: 900, canvasPixelsPerMetre: PPM, scan: { flow: [], pinned: [], freeLeft: 0, freeRight: 0 }, scrollY: 0, dock: choosePortalDock(perch, 900), panelStage: null, conversation: false, page, ...extra });

test("portal: the sidebar perch is used when it has room, otherwise the website's reserved bar", () => {
  assert.equal(choosePortalDock(perch, 900).kind, "perch");
  assert.equal(choosePortalDock({ ...perch, right: 75 }, 900).kind, "bar", "icon rail is too narrow");
  assert.equal(choosePortalDock({ ...perch, bottom: 400 }, 900).kind, "bar", "too short");
  assert.equal(choosePortalDock(null, 900).kind, "bar", "phones");
  assert.deepEqual(perchStrip(choosePortalDock(perch, 900)), { ...perch, bar: false });
});

test("portal: every page lands the whole figure inside the perch, at a readable size", () => {
  for (const page of ["Dashboard", "Clients", "Messages", "Workspace", "Vexbot"]) {
    const { target, shown, pixelsPerMetre } = stationTarget(layout(page));
    assert.ok(shown, page);
    const frame = silhouette(target.x, target.y, pixelsPerMetre, target.rest);
    assert.ok(frame.left >= perch.left && frame.right <= perch.right && frame.top >= perch.top && frame.bottom <= perch.bottom, `${page} ${JSON.stringify(frame)}`);
    assert.ok(pixelsPerMetre * 1.72 >= 96 && pixelsPerMetre * 1.72 <= 165, `${page} size`);
  }
  assert.equal(stationTarget(layout("Messages")).target.rest, "sit");
});

test("portal: changing page is a short hop along the perch, so it walks rather than flies", () => {
  const a = stationTarget(layout("Dashboard")).target, b = stationTarget(layout("Clients")).target;
  assert.notEqual(a.key, b.key);
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y) > 20 && Math.hypot(a.x - b.x, a.y - b.y) < 320);
});

test("portal: scrolling flies inside the perch strip and lands back on the spot", () => {
  const dock = choosePortalDock(perch, 900), spot = stationTarget(layout("Workspace")).target, flight = new Flight();
  const space = { viewportWidth: 1440, viewportHeight: 900, scrollY: 0, scan: { flow: [{ left: 275, right: 1400, top: 0, bottom: 4000 }], pinned: [], freeLeft: 0, freeRight: 0 }, controls: null, allowed: true, strip: perchStrip(dock) };
  flight.launch(spot.x, spot.y, spot.scale, spot.faceYaw);
  let maxRight = 0;
  for (let i = 0; i < 120; i++) { space.scrollY += 15; flight.step(1 / 60, spot, { speed: 900, direction: 1 }, true, space, PPM); maxRight = Math.max(maxRight, flight.x + 0.66 * flight.scale * PPM); }
  assert.equal(flight.phase, "cruise");
  assert.ok(maxRight <= perch.right, `stays in the sidebar: ${maxRight}`);
  for (let i = 0; i < 600 && flight.active; i++) flight.step(1 / 60, spot, { speed: 0, direction: 1 }, false, space, PPM);
  assert.equal(flight.phase, "grounded");
  assert.equal(flight.x, spot.x); assert.equal(flight.y, spot.y);
});

test("portal: the open assistant panel takes the character directly into its stage", () => {
  const { target } = stationTarget(layout("Dashboard", { panelStage: { left: 1040, right: 1152, top: 0, bottom: 132 } }));
  assert.equal(target.key, "panel"); assert.ok(target.instant);
});

test("portal: only the two glow materials turn purple; metal, polymer and visor are untouched", async () => {
  // bot-stage imports three's WebGL renderer, which loads fine without a canvas; only tintPurple is used.
  const { tintPurple, BOT_ACCENT } = await import("../src/vexbot/bot-stage.ts");
  const gltf = await loadBot();
  const before = {};
  gltf.scene.traverse(o => { if (o.isMesh) before[o.material.name] = o.material.color.getHexString(); });
  assert.deepEqual(tintPurple(gltf.scene).sort(), ["EyeGlow", "LimeGlow"]);
  gltf.scene.traverse(o => {
    if (!o.isMesh) return;
    const m = o.material;
    if (m.name === "LimeGlow" || m.name === "EyeGlow") assert.equal(`#${m.emissive.getHexString()}`, BOT_ACCENT.emissive);
    else assert.equal(m.color.getHexString(), before[m.name], m.name);
  });
});


test("all twelve clips preserve reference durations and exact gait metadata", async () => {
  const gltf = await loadBot();
  const durations = { Idle: 6, Walk: 1.04, TurnLeft: 1, TurnRight: 1, Wave: 2.5, SitDown: 1.5, SeatedIdle: 5, StandUp: 1.4, Listen: 4, Think: 4, Speak: 3.2, Present: 3 };
  for (const [name, seconds] of Object.entries(durations)) {
    assert.ok(Math.abs(gltf.animations.find(c => c.name === name).duration - seconds) < 1e-5, name);
  }
  assert.ok(Math.abs(gltf.scene.getObjectByName("Root").userData.vexoraBot.walkSpeed - 0.6513647642679901) < 1e-10);
});
