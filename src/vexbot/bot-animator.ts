// Plays the bot's clips with smooth blending and strict joint ownership.
//
// Each clip is split into a lower body half (Root, Hips, legs) and an upper body half. Exactly one
// "base" clip owns the lower body. The upper body belongs to the base clip until a gesture fades in,
// and the base's upper weight falls by the same amount, so per-joint weights always total 1 and a
// gesture such as Wave can run over Walk or SeatedIdle without the two fighting over any joint.
import { AnimationClip, AnimationMixer, LoopOnce, LoopRepeat, type AnimationAction, type Object3D } from "three";

export type BaseClip = "Idle" | "Walk" | "TurnLeft" | "TurnRight" | "SitDown" | "SeatedIdle" | "StandUp";
export type GestureClip = "Wave" | "Listen" | "Think" | "Speak" | "Present";
export type Posture = "standing" | "seated";

const LOWER_BODY = /^(Root|Hips|Thigh_|Shin_|Foot_|Toe_)/;
const ONE_SHOT_BASE = new Set<BaseClip>(["TurnLeft", "TurnRight", "SitDown", "StandUp"]);
const ONE_SHOT_GESTURE = new Set<GestureClip>(["Wave"]);
const BASE_FADE = 0.28;
const GESTURE_FADE = 0.32;

type Layered = { lower: AnimationAction; upper: AnimationAction };

export class BotAnimator {
  readonly mixer: AnimationMixer;
  private readonly actions = new Map<string, Layered>();
  private readonly baseWeights = new Map<BaseClip, number>();
  private readonly gestureWeights = new Map<GestureClip, number>();
  private readonly turnYaw: number;
  private gestureBlend = 0;
  private activeGesture: GestureClip | null = null;
  private current: BaseClip = "Idle";
  private desired: "Idle" | "Walk" | "SeatedIdle" = "Idle";
  private pendingTurn: "TurnLeft" | "TurnRight" | null = null;
  private frozen = false;
  /** Called the moment a turn clip ends. Add `yaw` to the character's outer rotation in the same frame. */
  onTurnComplete: ((yaw: number) => void) | null = null;

  constructor(root: Object3D, clips: AnimationClip[]) {
    this.mixer = new AnimationMixer(root);
    this.turnYaw = (root.userData?.vexoraBot?.turnYaw as number | undefined) ?? Math.PI / 2;
    for (const clip of clips) {
      const part = (suffix: string, keep: (name: string) => boolean) => new AnimationClip(`${clip.name}:${suffix}`, clip.duration, clip.tracks.filter(track => keep(track.name)));
      const lower = this.mixer.clipAction(part("lower", name => LOWER_BODY.test(name)));
      const upper = this.mixer.clipAction(part("upper", name => !LOWER_BODY.test(name)));
      const once = ONE_SHOT_BASE.has(clip.name as BaseClip) || ONE_SHOT_GESTURE.has(clip.name as GestureClip);
      for (const action of [lower, upper]) {
        action.setLoop(once ? LoopOnce : LoopRepeat, once ? 1 : Infinity);
        action.clampWhenFinished = once;
      }
      this.actions.set(clip.name, { lower, upper });
    }
    this.baseWeights.set("Idle", 1);
    this.apply();
  }

  get clipNames() { return [...this.actions.keys()]; }
  get base() { return this.current; }
  get gesture() { return this.activeGesture; }
  get isTurning() { return this.current === "TurnLeft" || this.current === "TurnRight" || this.pendingTurn !== null; }
  get isBusy() { return ONE_SHOT_BASE.has(this.current); }
  get posture(): Posture { return this.current === "SeatedIdle" || this.current === "SitDown" ? "seated" : "standing"; }

  /** Requests a resting or travelling state. Sitting and standing transitions are inserted automatically. */
  request(next: "Idle" | "Walk" | "SeatedIdle") {
    this.desired = next;
    if (!this.isBusy) this.advance();
  }

  /** Turns 90 degrees on the spot. Ignored while seated; movement code must stand first. */
  turn(direction: "TurnLeft" | "TurnRight") {
    if (this.posture === "seated") return false;
    if (this.isBusy) this.pendingTurn = direction;
    else this.start(direction);
    return true;
  }

  /** Speeds the walk cycle. Movement code must scale its travel by the same factor to keep feet planted. */
  setWalkRate(rate: number) {
    const walk = this.actions.get("Walk");
    walk?.lower.setEffectiveTimeScale(rate);
    walk?.upper.setEffectiveTimeScale(rate);
  }

  /** Fades in an upper-body gesture over whatever the lower body is doing. Pass null to release it. */
  setGesture(next: GestureClip | null) {
    if (next === this.activeGesture) return;
    this.activeGesture = next;
    if (next) {
      const action = this.actions.get(next)!;
      action.upper.reset();
      this.gestureWeights.set(next, this.gestureWeights.get(next) ?? 0);
    }
  }

  /** Freezes the character on one frame of one clip. Used for reduced motion and for visual QA. */
  pose(name: string, time: number) {
    this.frozen = true;
    this.mixer.stopAllAction();
    const action = this.actions.get(name);
    if (!action) throw new Error(`Unknown clip ${name}`);
    for (const half of [action.lower, action.upper]) {
      half.reset().setEffectiveWeight(1).play();
      half.time = time;
      half.paused = true;
    }
    this.mixer.update(0);
  }

  /** Leaves a frozen pose and returns to normal playback from Idle. */
  resume() {
    this.frozen = false;
    this.mixer.stopAllAction();
    this.baseWeights.clear();
    this.gestureWeights.clear();
    this.gestureBlend = 0;
    this.activeGesture = null;
    this.current = "Idle";
    this.baseWeights.set("Idle", 1);
  }

  /** Returns the summed blend weight per animated property, for verifying exclusive joint ownership. */
  jointWeights() {
    const totals = new Map<string, number>();
    for (const { lower, upper } of this.actions.values()) for (const half of [lower, upper]) {
      if (!half.isRunning() && !half.paused) continue;
      for (const track of half.getClip().tracks) totals.set(track.name, (totals.get(track.name) ?? 0) + half.getEffectiveWeight());
    }
    return totals;
  }

  update(delta: number) {
    if (this.frozen) return;
    this.finishOneShots();
    this.stepWeights(delta);
    this.apply();
    this.mixer.update(delta);
  }

  private advance() {
    if (this.pendingTurn && this.posture !== "seated") { const turn = this.pendingTurn; this.pendingTurn = null; this.start(turn); return; }
    const seated = this.posture === "seated";
    if (seated && this.desired !== "SeatedIdle") this.start("StandUp");
    else if (!seated && this.desired === "SeatedIdle") this.start("SitDown");
    else this.start(this.desired);
  }

  private start(next: BaseClip) {
    if (next === this.current && !ONE_SHOT_BASE.has(next)) return;
    this.current = next;
    const action = this.actions.get(next)!;
    if ((this.baseWeights.get(next) ?? 0) === 0 || ONE_SHOT_BASE.has(next)) { action.lower.reset(); action.upper.reset(); }
    this.baseWeights.set(next, this.baseWeights.get(next) ?? 0);
  }

  private finishOneShots() {
    if (ONE_SHOT_BASE.has(this.current) && this.finished(this.actions.get(this.current)!.lower)) {
      const ended = this.current;
      if (ended === "TurnLeft" || ended === "TurnRight") {
        // The turn's end pose faces 90 degrees away on Root. Hand that yaw to the outer group and jump
        // straight to the next clip, whose Root is at zero: the character does not move on screen.
        this.onTurnComplete?.(ended === "TurnLeft" ? this.turnYaw : -this.turnYaw);
        this.baseWeights.clear();
        this.current = "Idle";
        const idle = this.actions.get("Idle")!;
        idle.lower.reset(); idle.upper.reset();
        this.baseWeights.set("Idle", 1);
        this.advance();
        if (this.current !== "Idle") { this.baseWeights.delete("Idle"); this.baseWeights.set(this.current, 1); }
        return;
      }
      // SitDown keeps `seated` posture and StandUp ends standing, so the routing below is correct.
      this.current = ended === "SitDown" ? "SeatedIdle" : "Idle";
      const settled = this.actions.get(this.current)!;
      settled.lower.reset(); settled.upper.reset();
      this.baseWeights.set(this.current, this.baseWeights.get(this.current) ?? 0);
      this.advance();
    }
    if (this.activeGesture && ONE_SHOT_GESTURE.has(this.activeGesture) && this.finished(this.actions.get(this.activeGesture)!.upper)) this.activeGesture = null;
  }

  private finished(action: AnimationAction) {
    return action.time >= action.getClip().duration - 1e-3;
  }

  private stepWeights(delta: number) {
    const step = (weights: Map<string, number>, active: string | null, rate: number) => {
      for (const [name, weight] of weights) {
        const target = name === active ? 1 : 0;
        const moved = weight + Math.max(-rate, Math.min(rate, target - weight));
        if (moved <= 0 && name !== active) weights.delete(name); else weights.set(name, moved);
      }
      let total = 0;
      for (const weight of weights.values()) total += weight;
      if (total > 0) for (const [name, weight] of weights) weights.set(name, weight / total);
    };
    step(this.baseWeights as Map<string, number>, this.current, delta / BASE_FADE);
    const blendTarget = this.activeGesture ? 1 : 0;
    this.gestureBlend += Math.max(-delta / GESTURE_FADE, Math.min(delta / GESTURE_FADE, blendTarget - this.gestureBlend));
    if (this.activeGesture || this.gestureBlend > 0) step(this.gestureWeights as Map<string, number>, this.activeGesture ?? [...this.gestureWeights.keys()][0] ?? null, delta / GESTURE_FADE);
    if (this.gestureBlend <= 0) this.gestureWeights.clear();
  }

  private apply() {
    for (const [name, { lower, upper }] of this.actions) {
      const base = this.baseWeights.get(name as BaseClip) ?? 0;
      const gesture = (this.gestureWeights.get(name as GestureClip) ?? 0) * this.gestureBlend;
      setWeight(lower, base);
      setWeight(upper, base * (1 - this.gestureBlend) + gesture);
    }
  }
}

function setWeight(action: AnimationAction, weight: number) {
  if (weight <= 0) { if (action.isRunning() || action.getEffectiveWeight() > 0) action.stop(); return; }
  if (!action.isRunning()) action.play();
  action.setEffectiveWeight(weight);
}
