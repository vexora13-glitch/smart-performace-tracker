// Ported unchanged from the public Vexora website (src/lib/companion/director.ts).
// Moves the character between places on the page. All coordinates are CSS pixels of the point on the
// floor between its feet. Nothing here touches the DOM, so behaviour can be tested without a browser.
//
// Walk is an in-place cycle: this class supplies the travel, at the exact speed the clip's feet move
// backward at, so a planted foot stays still on screen and does not skate.
//
// Scrolling and any long move between places are flown instead; see flight.ts. Walking remains for short hops.
import type { BotAnimator, GestureClip } from "../bot-animator";
import { Flight, ScrollWatch, type Airspace } from "./flight.ts";

export type CompanionTarget = {
  /** Identifies the place. The character walks only when this changes; otherwise it rides along with it. */
  key: string;
  x: number;
  y: number;
  scale: number;
  rest: "stand" | "sit";
  gesture: GestureClip | null;
  /** Where to face on arrival. 0 is the viewer; positive is toward screen right. */
  faceYaw: number;
  /** Appear here directly, and leave directly too, rather than walking through whatever is in the way. */
  instant?: boolean;
  /** Stands on the page itself, so a small scroll carries it along rather than making it take off. */
  anchored?: boolean;
};

export type DirectorStage = {
  animator: Pick<BotAnimator, "request" | "turn" | "setGesture" | "setWalkRate" | "pose" | "resume" | "isBusy" | "posture">;
  meta: { walkSpeed: number };
  yaw: number;
  setSeatVisible(visible: boolean): void;
  setAttitude(pitch: number, bank: number, air: number, crouch: number): void;
};

const TURN_THRESHOLD = 1.05;
const FLY_BEYOND_PIXELS = 320;
const MAX_WALK_RATE = 2.4;
const COMFORTABLE_WALK_SECONDS = 3.2;
const wrap = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));

export class CompanionDirector {
  x = 0;
  y = 0;
  scale = 1;
  /** Pixels per metre when `scale` is 1. */
  private readonly basePixelsPerMetre: number;
  private readonly stage: DirectorStage;
  private target: CompanionTarget | null = null;
  private arrivedKey: string | null = null;
  private attention: GestureClip | null = null;
  private appliedGesture: GestureClip | null = null;
  private gesturePlayedFor: string | null = null;
  private ramp = 0;
  private frozenSignature = "";
  private readonly flight = new Flight();
  private readonly watch = new ScrollWatch();
  private space: Airspace | null = null;
  /** Stay put: go straight to each place instead of walking. For the "keep still" control and reduced motion. */
  still = false;
  /** Prefers-reduced-motion: also hold a single frame instead of animating. */
  frozen = false;

  constructor(stage: DirectorStage, basePixelsPerMetre: number) {
    this.stage = stage;
    this.basePixelsPerMetre = basePixelsPerMetre;
  }

  get state() {
    if (!this.target) return "waiting";
    return this.arrivedKey === this.target.key && !this.flight.active ? "resting" : "travelling";
  }
  get place() { return this.target?.key ?? null; }
  get flightPhase() { return this.flight.phase; }
  get pitch() { return this.flight.pitch; }
  get bank() { return this.flight.bank; }

  setTarget(next: CompanionTarget) {
    if (!this.target) { this.x = next.x; this.y = next.y; this.scale = next.scale; this.arrivedKey = next.key; this.stage.yaw = next.faceYaw; }
    else if (next.key !== this.target.key && (next.instant || this.target.instant)) {
      this.x = next.x; this.y = next.y; this.scale = next.scale; this.arrivedKey = next.key;
      this.stage.setSeatVisible(false);
      this.ground();
    }
    this.target = next;
  }

  /** What the character can fly through this frame. Without one it never takes off. */
  setAirspace(space: Airspace) { this.space = space; }

  /** Listen, Think and Speak override whatever pose the current place asks for, even mid-walk. */
  setAttention(gesture: GestureClip | null) { this.attention = gesture; }

  /** Pixels per second that keep a planted foot still on screen at the current size. */
  get footSpeed() { return this.stage.meta.walkSpeed * this.basePixelsPerMetre * this.scale; }

  update(delta: number) {
    const target = this.target;
    if (!target) return;
    if (!this.frozen && this.frozenSignature) { this.frozenSignature = ""; this.stage.animator.resume(); }
    if (this.space) this.watch.update(this.space.scrollY, delta);
    if (this.frozen || this.still) {
      this.ground();
      this.x = target.x; this.y = target.y; this.scale = target.scale; this.arrivedKey = target.key;
      if (this.frozen) { this.holdFrame(target); return; }
      this.stage.yaw = target.faceYaw;
      this.settle(target);
      return;
    }
    if (this.flight.active || this.wantsToFly(target)) { this.fly(target, delta); return; }
    if (this.arrivedKey === target.key) {
      this.x = target.x; this.y = target.y; this.scale = target.scale;
      this.settle(target);
      return;
    }
    this.travel(target, delta);
  }

  private keepsFlying(target: CompanionTarget) {
    return Boolean(this.space?.allowed) && !target.anchored && this.watch.scrolling;
  }

  private wantsToFly(target: CompanionTarget) {
    if (!this.space?.allowed || target.instant) return false;
    return this.keepsFlying(target) || (this.arrivedKey !== target.key && Math.hypot(target.x - this.x, target.y - this.y) > FLY_BEYOND_PIXELS);
  }

  private fly(target: CompanionTarget, delta: number) {
    const { animator } = this.stage;
    const space = this.space!, flight = this.flight;
    this.applyGesture(this.attention);
    if (!flight.active) {
      // Sitting, or partway through a turn: finish getting up first, then lift off from where it stands.
      if (animator.posture === "seated" || animator.isBusy) { animator.request("Idle"); return; }
      this.stage.setSeatVisible(false);
      animator.setWalkRate(1);
      flight.launch(this.x, this.y, this.scale, this.stage.yaw);
    }
    animator.request("Idle");
    flight.step(delta, target, this.watch, this.keepsFlying(target), space, this.basePixelsPerMetre);
    this.x = flight.x; this.y = flight.y; this.scale = flight.scale;
    this.stage.yaw = flight.yaw;
    this.stage.setAttitude(flight.pitch, flight.bank, flight.air, flight.crouch);
    if (!flight.active) this.arrive(target);
  }

  private ground() {
    if (!this.flight.active) return;
    this.flight.cancel();
    this.stage.setAttitude(0, 0, 0, 0);
  }

  private travel(target: CompanionTarget, delta: number) {
    const { animator } = this.stage;
    this.applyGesture(this.attention);
    if (animator.posture === "seated" || animator.isBusy) { animator.request("Idle"); this.ramp = 0; return; }
    this.stage.setSeatVisible(false);
    const dx = target.x - this.x, dy = target.y - this.y, distance = Math.hypot(dx, dy);
    if (distance < 1) { this.arrive(target); return; }
    // Moving down the screen reads as walking toward the viewer, up the screen as walking away.
    const heading = Math.atan2(dx, dy), error = wrap(heading - this.stage.yaw);
    if (Math.abs(error) > TURN_THRESHOLD) { animator.turn(error > 0 ? "TurnLeft" : "TurnRight"); this.ramp = 0; return; }
    this.stage.yaw += error * Math.min(1, delta * 7);
    const rate = Math.min(MAX_WALK_RATE, Math.max(1, distance / (this.footSpeed * COMFORTABLE_WALK_SECONDS)));
    animator.setWalkRate(rate);
    animator.request("Walk");
    this.ramp = Math.min(1, this.ramp + delta / 0.22);
    const step = this.footSpeed * rate * this.ramp * delta;
    if (step >= distance) { this.arrive(target); return; }
    const progress = step / distance;
    this.x += dx * progress; this.y += dy * progress;
    this.scale += (target.scale - this.scale) * progress;
  }

  private arrive(target: CompanionTarget) {
    this.x = target.x; this.y = target.y; this.scale = target.scale;
    this.arrivedKey = target.key;
    this.stage.animator.setWalkRate(1);
    this.gesturePlayedFor = null;
  }

  private settle(target: CompanionTarget) {
    const { animator } = this.stage;
    if (this.attention) this.applyGesture(this.attention);
    if (animator.isBusy) return;
    const error = wrap(target.faceYaw - this.stage.yaw);
    if (animator.posture !== "seated" && Math.abs(error) > TURN_THRESHOLD) { animator.turn(error > 0 ? "TurnLeft" : "TurnRight"); return; }
    if (animator.posture !== "seated") this.stage.yaw += error * 0.08;
    if (target.rest === "sit") { this.stage.setSeatVisible(true); animator.request("SeatedIdle"); }
    else { animator.request("Idle"); if (animator.posture !== "seated") this.stage.setSeatVisible(false); }
    if (animator.isBusy) return;
    if (this.attention) return;
    // A place's gesture starts on arrival. Wave then ends itself; held poses return after a conversation.
    if (this.gesturePlayedFor !== target.key) { this.gesturePlayedFor = target.key; this.applyGesture(target.gesture); return; }
    if (this.appliedGesture !== "Wave" || target.gesture !== "Wave") this.applyGesture(target.gesture === "Wave" ? null : target.gesture);
  }

  private applyGesture(next: GestureClip | null) {
    if (this.appliedGesture === next) return;
    this.appliedGesture = next;
    this.stage.animator.setGesture(next);
  }

  private holdFrame(target: CompanionTarget) {
    this.stage.yaw = target.faceYaw;
    this.stage.setSeatVisible(target.rest === "sit");
    const clip = this.attention ?? target.gesture ?? (target.rest === "sit" ? "SeatedIdle" : "Idle");
    const signature = `${clip}`;
    if (signature === this.frozenSignature) return;
    this.frozenSignature = signature;
    this.stage.animator.pose(clip, clip === "Wave" ? 1.1 : 0.5);
  }
}
