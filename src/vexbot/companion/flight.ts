// Ported unchanged from the public Vexora website (src/lib/companion/flight.ts) except the optional
// `Airspace.strip` override used by the portal's sidebar perch.
// How the character flies while the page scrolls: takeoff, cruise, approach, touchdown. It flies inside a clear
// strip at the side of the viewport, measured from where the page's content actually starts, so it never
// crosses the content in the middle of the screen. With no clear strip it stays in its own end of the reserved
// bar, which nothing on the page can be under. Starting anywhere else, such as the hero, it first slides
// sideways through the open band of the page it's standing in, and it returns the same way.
// All coordinates are viewport CSS pixels of the point between the feet. Nothing here touches the DOM, so
// behaviour can be tested without a browser.
import { headerBottom as pinnedHeader, SAFETY_MARGIN, type Rect, type Scan } from "./safe-layout.ts";

export type FlightPhase = "grounded" | "takeoff" | "cruise" | "approach" | "touchdown";

export type Airspace = {
  viewportWidth: number;
  viewportHeight: number;
  scrollY: number;
  scan: Scan | null;
  /** The companion's own controls, which the scan leaves out because they belong to the companion. */
  controls: Rect | null;
  /** False during a voice conversation, an open panel, or when the character is collapsed. */
  allowed: boolean;
  /**
   * Portal adaptation: a strip reserved for the character by the layout itself (the sidebar perch). When
   * present it replaces the measured corridor; everything else about flight is the website's original.
   */
  strip?: Corridor | null;
};

export type LandingSpot = { x: number; y: number; scale: number; faceYaw: number };

/** The strip the whole flying figure stays inside. `bar` means it's the character's own end of a reserved bar. */
export type Corridor = Rect & { bar: boolean };

type Band = { top: number; bottom: number };

/** How long the page has to be still before the character lands. */
export const SCROLL_SETTLE_SECONDS = 0.32;
/** Ignores trackpad nudges and single wheel clicks, so a small scroll never sends it up and down again. */
const SCROLL_START_PIXELS = 120;
const MAX_SCROLL_SPEED = 4000;

// The flying figure's extents in metres from the point between the feet, widest at any facing. Wider and
// taller than standing: the arms spread in the flying pose, and pitch and bank tilt it about the hips.
// tests/companion-flight-qa.mjs checks these against the pixels actually drawn.
const FLIGHT = { side: 0.66, above: 1.78, below: 0.1 };
const STANDING_SIDE = 0.56;
// Inside a reserved bar the bar itself is the boundary, so only a hairline is kept.
const BAR_MARGIN = 2;
// Smaller in the bar than at rest, so there's room in it to lift off.
const BAR_FLIGHT_SHARE = 0.75;
// Fills this much of a narrow strip, leaving a little room to sway.
const STRIP_FILL = 0.94;

const TAKEOFF_SECONDS = 0.5;
const LIFT_SECONDS = 0.3;
const DEPART_LIFT_SECONDS = 0.12;
const LIFT_SPEED = 160;
const CRUISE_SPEED = 520;
const CRUISE_ACCELERATION = 1500;
const CRUISE_RESPONSE = 2.4;
const DEPART_SPEED = 700;
const MAX_DEPART_SPEED = 2400;
const DEPART_ACCELERATION = 6000;
const APPROACH_SPEED = 560;
const APPROACH_ACCELERATION = 1100;
const TOUCHDOWN_SECONDS = 0.62;
const SETTLE_SECONDS = 0.4;
const APPROACH_LIMIT_SECONDS = 5;
const MAX_DIVE_PITCH = 0.95;
const MAX_CLIMB_PITCH = 0.35;
const MAX_BANK = 0.55;
// A roll swings the head sideways, so in a narrow strip it stays slight.
const STRIP_BANK = 0.12;
const BAR_BANK = 0.06;
const MAX_FLIGHT_YAW = 1.1;
const EDGE_BRAKE_PIXELS = 70;
const LANDING_CROUCH = 0.3;
const MIN_CRUISE_PIXELS = 110;
const MAX_CRUISE_PIXELS = 165;

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const ease = (rate: number, delta: number) => 1 - Math.exp(-rate * delta);
const smooth = (value: number) => { const t = clamp(value, 0, 1); return t * t * (3 - 2 * t); };
const wrap = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));
const headerBottom = (space: Airspace) => pinnedHeader(space.scan, space.viewportHeight);

/** Tells scrolling apart from standing still, from nothing but the scroll position each frame. */
export class ScrollWatch {
  speed = 0;
  direction: 1 | -1 = 1;
  private last: number | null = null;
  private quiet = Infinity;
  private travelled = 0;
  private movingFrames = 0;

  update(scrollY: number, delta: number) {
    const moved = this.last === null ? 0 : scrollY - this.last;
    this.last = scrollY;
    if (Math.abs(moved) >= 0.5) {
      this.quiet = 0;
      this.travelled += Math.abs(moved);
      this.movingFrames++;
      this.direction = moved > 0 ? 1 : -1;
    } else {
      this.quiet += delta;
      if (this.quiet >= SCROLL_SETTLE_SECONDS) { this.travelled = 0; this.movingFrames = 0; }
    }
    const instant = delta > 0 ? clamp(moved / delta, -MAX_SCROLL_SPEED, MAX_SCROLL_SPEED) : 0;
    this.speed += (instant - this.speed) * ease(6, delta);
  }

  /**
   * Has moved far enough, recently enough, to count as the visitor scrolling. It also has to span more than
   * one frame: the browser corrects the position in a single jump when content above changes height, which
   * the auto-playing demo does every few seconds on small screens, and that isn't anyone scrolling.
   */
  get scrolling() { return this.travelled >= SCROLL_START_PIXELS && this.movingFrames >= 2 && this.quiet < SCROLL_SETTLE_SECONDS; }
}

/**
 * The strip to fly in for a landing spot. On a wide screen it's the column beside the content on the spot's
 * side, as wide as the page's content leaves clear over its whole length, so it stays clear however far the
 * page scrolls. With a reserved bar, it's the character's end of the bar.
 */
export function corridor(space: Airspace, spot: { x: number }): Corridor {
  const { viewportWidth: width, viewportHeight: height, scan, controls } = space;
  if (controls && controls.right - controls.left > width / 2) return { left: 0, right: Math.max(0, spot.x * 2), top: controls.top, bottom: height, bar: true };
  const onLeft = spot.x < width / 2;
  const left = !scan || onLeft ? 0 : width - scan.freeRight, right = !scan ? width : onLeft ? scan.freeLeft : width;
  const bottom = controls && controls.left < right && controls.right > left ? controls.top : height;
  return { left, right, top: headerBottom(space), bottom, bar: false };
}

/** The range the feet can occupy with the whole flying figure inside the strip. A strip too small pins it to the middle and the floor. */
export function flightZone(strip: Corridor, pixelsPerMetre: number) {
  const margin = strip.bar ? BAR_MARGIN : SAFETY_MARGIN, middle = (strip.left + strip.right) / 2;
  const left = strip.left + FLIGHT.side * pixelsPerMetre + margin, right = strip.right - FLIGHT.side * pixelsPerMetre - margin;
  const bottom = strip.bottom - FLIGHT.below * pixelsPerMetre - margin, top = Math.min(bottom, strip.top + FLIGHT.above * pixelsPerMetre + margin);
  return { left: Math.min(left, middle), right: Math.max(right, middle), top, bottom };
}

/** The size to fly at. A big hero figure shrinks for the journey; a tiny one in the bar grows enough to read. */
export function cruiseScale(restScale: number, canvasPixelsPerMetre: number, viewportWidth: number) {
  const restPixels = restScale * canvasPixelsPerMetre * 1.72;
  const smallest = Math.min(MIN_CRUISE_PIXELS, viewportWidth * 0.2);
  return clamp(restPixels, smallest, MAX_CRUISE_PIXELS) / (canvasPixelsPerMetre * 1.72);
}

/** The flight size, made smaller where the strip is too narrow for it. */
export function flightScale(strip: Corridor, restScale: number, canvasPixelsPerMetre: number, viewportWidth: number) {
  if (strip.bar) return restScale * BAR_FLIGHT_SHARE;
  const fits = ((strip.right - strip.left - SAFETY_MARGIN * 2) / (FLIGHT.side * 2)) * STRIP_FILL / canvasPixelsPerMetre;
  return Math.max(0.05, Math.min(cruiseScale(restScale, canvasPixelsPerMetre, viewportWidth), fits));
}

/**
 * The open band of the page, in document coordinates, that a figure spanning `top` to `bottom` can slide
 * sideways through between `fromX` and `toX`, with the safety margin kept. Content is above or below it by
 * its middle, so a figure the page has just jumped into still finds the band it's mostly in. Null if that
 * band is too narrow for the figure.
 */
export function openBand(flow: Rect[], fromX: number, toX: number, top: number, bottom: number): Band | null {
  const left = Math.min(fromX, toX) - SAFETY_MARGIN, right = Math.max(fromX, toX) + SAFETY_MARGIN, middle = (top + bottom) / 2;
  let above = -Infinity, below = Infinity;
  for (const item of flow) {
    if (item.right <= left || item.left >= right) continue;
    if ((item.top + item.bottom) / 2 < middle) above = Math.max(above, item.bottom + SAFETY_MARGIN);
    else below = Math.min(below, item.top - SAFETY_MARGIN);
  }
  return below - above >= bottom - top ? { top: above, bottom: below } : null;
}

export class Flight {
  phase: FlightPhase = "grounded";
  x = 0;
  y = 0;
  scale = 1;
  vx = 0;
  vy = 0;
  /** Forward lean, toward the viewer, in radians. Negative leans back. */
  pitch = 0;
  /** Roll in the screen's plane, in radians. Positive leans the head toward screen left. */
  bank = 0;
  yaw = 0;
  /** How far the legs and arms have blended from standing to flying, from 0 to 1. */
  air = 0;
  /** How deep the knees are bent to absorb a landing, in radians at the thigh. */
  crouch = 0;
  private time = 0;
  private clock = 0;
  private start = { x: 0, y: 0, scale: 1 };
  /** The open band being crossed outside the strip. Undefined until it's needed. */
  private band: Band | null | undefined;
  /** Set once a landing outside the strip has left it, to grow on the way in. */
  private crossing: { fromX: number; scale: number } | null = null;

  get active() { return this.phase !== "grounded"; }

  launch(x: number, y: number, scale: number, yaw: number) {
    this.phase = "takeoff";
    this.x = x; this.y = y; this.scale = scale; this.yaw = yaw;
    this.vx = 0; this.vy = 0;
    this.time = 0;
    this.band = undefined;
    this.crossing = null;
  }

  /** Stops flying at once: the character is being placed directly somewhere. */
  cancel() {
    this.phase = "grounded";
    this.vx = 0; this.vy = 0; this.pitch = 0; this.bank = 0; this.air = 0; this.crouch = 0;
    this.band = undefined;
    this.crossing = null;
  }

  /** `scrolling` keeps it in the air; `watch.speed` is the page's smoothed signed speed. */
  step(delta: number, spot: LandingSpot, watch: { speed: number; direction: 1 | -1 }, scrolling: boolean, space: Airspace, canvasPixelsPerMetre: number) {
    if (this.phase === "grounded") return;
    this.time += delta;
    this.clock += delta;
    const reach = clamp(space.viewportHeight / 900, 0.55, 1.1);
    const strip = space.strip ?? corridor(space, spot);

    if (scrolling && (this.phase === "approach" || this.phase === "touchdown")) { this.enter("cruise"); this.band = undefined; this.crossing = null; }
    if (!scrolling && this.phase === "cruise") this.beginApproach(spot, space, strip, canvasPixelsPerMetre);
    if (this.phase === "takeoff" && this.time >= TAKEOFF_SECONDS) {
      if (scrolling) this.enter("cruise"); else this.beginApproach(spot, space, strip, canvasPixelsPerMetre);
    }

    if (this.phase === "touchdown") { this.touchdown(delta, spot); return; }
    const zone = flightZone(strip, this.scale * canvasPixelsPerMetre);
    const outside = this.x < zone.left - 1 || this.x > zone.right + 1;
    if (outside && this.inStrip(spot, strip, canvasPixelsPerMetre)) { this.depart(delta, spot, watch, space, strip, canvasPixelsPerMetre, reach); return; }
    if (!outside && this.phase !== "approach") this.band = undefined;
    if (this.phase === "approach") { this.approach(delta, spot, space, strip, canvasPixelsPerMetre, reach); return; }
    this.cruise(delta, spot, watch, space, strip, canvasPixelsPerMetre, reach);
  }

  private enter(phase: FlightPhase) {
    this.phase = phase;
    this.time = 0;
  }

  private inStrip(spot: LandingSpot, strip: Corridor, canvasPixelsPerMetre: number) {
    const side = STANDING_SIDE * spot.scale * canvasPixelsPerMetre;
    return spot.x - side >= strip.left - 1 && spot.x + side <= strip.right + 1;
  }

  private beginApproach(spot: LandingSpot, space: Airspace, strip: Corridor, canvasPixelsPerMetre: number) {
    this.enter("approach");
    this.crossing = null;
    if (this.inStrip(spot, strip, canvasPixelsPerMetre) || !space.scan) return;
    // Landing outside the strip, as in the hero: find the open band it can slide across to get there.
    const pixelsPerMetre = this.scale * canvasPixelsPerMetre, feet = spot.y + space.scrollY;
    const fromX = strip.left < space.viewportWidth / 2 ? strip.left : strip.right;
    const towardX = spot.x + Math.sign(spot.x - fromX) * STANDING_SIDE * spot.scale * canvasPixelsPerMetre;
    this.band = openBand(space.scan.flow, fromX, towardX, feet - FLIGHT.above * pixelsPerMetre, feet + FLIGHT.below * pixelsPerMetre);
  }

  /**
   * Where the feet may be: `low` to `high` keeps the whole figure inside the open band and on screen under the
   * header. `bandLow` and `bandHigh` are the band's own limits, which may have moved off screen.
   */
  private bandLimits(space: Airspace, pixelsPerMetre: number) {
    const screenTop = headerBottom(space) + FLIGHT.above * pixelsPerMetre + SAFETY_MARGIN, screenBottom = space.viewportHeight - FLIGHT.below * pixelsPerMetre - SAFETY_MARGIN;
    const band = this.band;
    const bandLow = band ? band.top - space.scrollY + FLIGHT.above * pixelsPerMetre : -Infinity, bandHigh = band ? band.bottom - space.scrollY - FLIGHT.below * pixelsPerMetre : Infinity;
    const low = Math.max(screenTop, bandLow), high = Math.min(screenBottom, bandHigh);
    return { low, high, bandLow, bandHigh, screenTop, screenBottom, banded: Boolean(band) && high >= low };
  }

  /** The climb out: lift first, then lean toward where it's going, with thrust building as it does. */
  private lift(wantX: number, wantY: number, seconds: number) {
    if (this.phase !== "takeoff") return { wantX, wantY, thrust: 1 };
    const lean = smooth(this.time / seconds);
    return { wantX: wantX * lean, wantY: wantY * lean - LIFT_SPEED * (1 - lean), thrust: 0.4 + 0.6 * lean };
  }

  /** Outside the strip: slides sideways through the open band into it, quickly enough to beat the page. */
  private depart(delta: number, spot: LandingSpot, watch: { speed: number }, space: Airspace, strip: Corridor, canvasPixelsPerMetre: number, reach: number) {
    const target = flightScale(strip, spot.scale, canvasPixelsPerMetre, space.viewportWidth);
    this.scale += (target - this.scale) * ease(5, delta);
    const pixelsPerMetre = this.scale * canvasPixelsPerMetre;
    const zone = flightZone(strip, pixelsPerMetre);
    let toX = (zone.left + zone.right) / 2;
    // A bar is reached by coming down beside the content, not through it.
    if (strip.bar && space.scan) toX = clamp(space.scan.freeLeft - FLIGHT.side * pixelsPerMetre - SAFETY_MARGIN, zone.left, toX);
    if (this.band === undefined) {
      const size = target * canvasPixelsPerMetre, feet = this.y + space.scrollY;
      const edge = this.x + Math.sign(this.x - toX) * FLIGHT.side * pixelsPerMetre;
      this.band = space.scan ? openBand(space.scan.flow, toX, edge, feet - FLIGHT.above * size, feet + FLIGHT.below * size) : null;
    }
    const { low, high, bandLow, bandHigh, screenTop, screenBottom, banded } = this.bandLimits(space, pixelsPerMetre);
    // The band moves with the page, so the faster the page moves, the sooner it leaves the screen. Should it
    // leave first, the character goes with it past the edge of the screen rather than out over the content,
    // and comes back down into the strip.
    const speed = watch.speed;
    // Just out of view is far enough: nothing it passes there can be seen.
    const aboveScreen = -FLIGHT.below * pixelsPerMetre - 2, belowScreen = space.viewportHeight + FLIGHT.above * pixelsPerMetre + 2;
    const ridingLow = Math.min(bandLow, belowScreen), ridingHigh = Math.max(bandHigh, aboveScreen);
    const toY = banded ? clamp(this.y, low, high) : this.band ? (speed < 0 ? ridingLow : ridingHigh) : clamp(this.y, screenTop, screenBottom);
    const remaining = speed > 40 ? (high - screenTop) / speed : speed < -40 ? (screenBottom - low) / -speed : Infinity;
    const distance = toX - this.x;
    const pace = Math.min(MAX_DEPART_SPEED, Math.max(DEPART_SPEED * reach, (Math.abs(distance) / Math.max(0.1, remaining)) * 1.4), 40 + Math.abs(distance) * 10);
    // Held at an edge of the band, it rides along with the page, but no further than just out of view.
    const riding = this.band && toY !== this.y && toY !== aboveScreen && toY !== belowScreen ? -speed : 0;
    const { wantX, wantY, thrust } = this.lift(Math.sign(distance) * pace, (toY - this.y) * 8 + riding, DEPART_LIFT_SECONDS);
    this.steer(wantX, wantY, DEPART_ACCELERATION * reach * thrust, delta);
    this.move(delta);
    // The edge the page is pushing toward it holds firm, so it moves with the page however fast that is. The
    // other is only steered away from, so the hero's big figure shrinking into the band doesn't snap.
    if (this.band && speed > 0) this.y = Math.min(this.y, ridingHigh);
    if (this.band && speed < 0) this.y = Math.max(this.y, ridingLow);
    if (this.band && !banded) this.y = clamp(this.y, aboveScreen, belowScreen);
    this.attitude(delta, spot, reach, 0, this.vy, MAX_BANK);
    this.air += (1 - this.air) * ease(5, delta);
    this.crouch += (0 - this.crouch) * ease(10, delta);
  }

  /** Inside the strip while the page scrolls: a steady glide with a slow rise and fall and a little sway. */
  private cruise(delta: number, spot: LandingSpot, watch: { speed: number; direction: 1 | -1 }, space: Airspace, strip: Corridor, canvasPixelsPerMetre: number, reach: number) {
    const target = flightScale(strip, spot.scale, canvasPixelsPerMetre, space.viewportWidth);
    this.scale += (target - this.scale) * ease(3, delta);
    const zone = flightZone(strip, this.scale * canvasPixelsPerMetre);
    const height = zone.bottom - zone.top, width = zone.right - zone.left;
    // Scrolling down it holds mid height, on its way to landing at the bottom; scrolling up it climbs higher.
    const toY = zone.top + height * (watch.direction > 0 ? 0.5 : 0.2) + Math.sin(this.clock * 1.3) * Math.min(height * 0.06, 22);
    const toX = (zone.left + zone.right) / 2 + Math.sin(this.clock * 0.9) * width * 0.4;
    let wantX = (toX - this.x) * CRUISE_RESPONSE, wantY = (toY - this.y) * CRUISE_RESPONSE;
    const limit = CRUISE_SPEED * reach, size = Math.hypot(wantX, wantY);
    if (size > limit) { wantX *= limit / size; wantY *= limit / size; }
    const lifted = this.lift(wantX, wantY, LIFT_SECONDS);
    this.steer(lifted.wantX, lifted.wantY, CRUISE_ACCELERATION * reach * lifted.thrust, delta);
    this.keepWithin(zone, delta);
    this.move(delta);
    // It leans with the page's movement as well as its own, so a fast scroll reads as a faster flight.
    this.attitude(delta, spot, reach, 0, this.vy + clamp(watch.speed * 0.25, -450, 450), strip.bar ? BAR_BANK : STRIP_BANK);
    this.air += (1 - this.air) * ease(5, delta);
    this.crouch += (0 - this.crouch) * ease(10, delta);
  }

  private approach(delta: number, spot: LandingSpot, space: Airspace, strip: Corridor, canvasPixelsPerMetre: number, reach: number) {
    const inside = this.inStrip(spot, strip, canvasPixelsPerMetre);
    const zone = flightZone(strip, this.scale * canvasPixelsPerMetre);
    const hover = Math.max(18, spot.scale * 40);
    // It hovers just above the spot before settling, but never so high that it leaves the strip.
    let toX = spot.x, toY = Math.max(spot.y - hover, Math.min(zone.top, spot.y));
    if (inside) this.scale += (spot.scale - this.scale) * ease(3.5, delta);
    else {
      // Out of the strip, as in the hero: level with the spot first, then slide across the open band, growing on the way.
      const { low, high, banded } = this.bandLimits(space, this.scale * canvasPixelsPerMetre);
      if (banded) toY = clamp(spot.y - hover, low, Math.max(high, spot.y));
      if (!this.crossing) {
        if (Math.abs(toY - this.y) > 14) toX = clamp(this.x, zone.left, zone.right);
        else this.crossing = { fromX: this.x, scale: this.scale };
      }
      if (this.crossing) {
        const progress = (this.x - this.crossing.fromX) / (spot.x - this.crossing.fromX || 1);
        this.scale = this.crossing.scale + (spot.scale - this.crossing.scale) * smooth(progress);
      }
    }
    const dx = toX - this.x, dy = toY - this.y, distance = Math.max(1, Math.hypot(dx, dy));
    const speed = Math.min(APPROACH_SPEED * reach, 50 + distance * 2.4);
    this.steer((dx / distance) * speed, (dy / distance) * speed, APPROACH_ACCELERATION * reach, delta);
    if (inside) this.keepWithin({ left: Math.min(zone.left, spot.x), right: Math.max(zone.right, spot.x), top: Math.min(zone.top, toY), bottom: Math.max(zone.bottom, spot.y) }, delta);
    this.move(delta);
    if (this.crossing) {
      // Growing on the way across, the head must not rise out of the band into what's above it.
      const { low, banded } = this.bandLimits(space, this.scale * canvasPixelsPerMetre);
      if (banded) this.y = Math.max(this.y, Math.min(low, spot.y + 12));
    }
    const left = Math.hypot(spot.x - this.x, spot.y - this.y);
    this.attitude(delta, spot, reach, smooth(1 - left / 220), this.vy, inside ? (strip.bar ? BAR_BANK : STRIP_BANK) : MAX_BANK);
    this.crouch += (0 - this.crouch) * ease(10, delta);
    if ((Math.hypot(spot.x - this.x, toY - this.y) < 16 && Math.hypot(this.vx, this.vy) < 90) || this.time > APPROACH_LIMIT_SECONDS) {
      this.start = { x: this.x, y: this.y, scale: this.scale };
      this.enter("touchdown");
    }
  }

  private touchdown(delta: number, spot: LandingSpot) {
    const progress = clamp(this.time / TOUCHDOWN_SECONDS, 0, 1), blend = smooth(progress);
    this.vx = 0; this.vy = 0;
    this.x = this.start.x + (spot.x - this.start.x) * blend;
    this.y = this.start.y + (spot.y - this.start.y) * blend;
    this.scale = this.start.scale + (spot.scale - this.start.scale) * blend;
    this.yaw += wrap(spot.faceYaw - this.yaw) * ease(6, delta);
    this.bank += (0 - this.bank) * ease(8, delta);
    this.air += (0 - this.air) * ease(7, delta);
    // Knees give as the feet meet the floor and the body rocks back, then both settle.
    const after = Math.max(0, this.time - TOUCHDOWN_SECONDS * 0.7);
    this.crouch = after > 0 ? LANDING_CROUCH * Math.sin(Math.min(1, after / (SETTLE_SECONDS * 0.35)) * (Math.PI / 2)) * Math.exp(-after * 5) : 0;
    const flare = progress < 1 ? -0.08 * Math.sin(progress * Math.PI) : 0.03 * Math.exp(-after * 5) * Math.cos(after * 11);
    this.pitch += (flare - this.pitch) * ease(12, delta);
    if (this.time >= TOUCHDOWN_SECONDS + SETTLE_SECONDS) {
      this.yaw = spot.faceYaw;
      this.x = spot.x; this.y = spot.y; this.scale = spot.scale;
      this.cancel();
    }
  }

  private steer(wantX: number, wantY: number, acceleration: number, delta: number) {
    const changeX = wantX - this.vx, changeY = wantY - this.vy, change = Math.hypot(changeX, changeY), limit = acceleration * delta;
    const portion = change > limit ? limit / change : 1;
    this.vx += changeX * portion;
    this.vy += changeY * portion;
  }

  private keepWithin(zone: { left: number; right: number; top: number; bottom: number }, delta: number) {
    this.vx = this.brake(this.vx, this.x, zone.left, zone.right, delta);
    this.vy = this.brake(this.vy, this.y, zone.top, zone.bottom, delta);
  }

  /** Slows movement toward an edge of the zone, to nothing at the edge. It may start outside, so it's never moved back in here. */
  private brake(velocity: number, position: number, low: number, high: number, delta: number) {
    const room = velocity < 0 ? position - low : high - position;
    if (room <= 0) return 0;
    const braked = velocity * (1 - ease(20 * (1 - clamp(room / EDGE_BRAKE_PIXELS, 0, 1)), delta));
    // A long frame must not carry it past the edge either.
    return Math.abs(braked) * delta > room ? Math.sign(braked) * (room / delta) : braked;
  }

  private move(delta: number) {
    this.x += this.vx * delta;
    this.y += this.vy * delta;
  }

  /**
   * Leans into the motion. `landing` runs from 0 to 1 near the ground, levelling out and turning to face
   * forward. `climb` is the vertical speed it should look like it has, and `maxBank` the most it may roll.
   */
  private attitude(delta: number, spot: LandingSpot, reach: number, landing: number, climb: number, maxBank: number) {
    const reference = 900 * reach, speed = Math.hypot(this.vx, this.vy);
    const dive = clamp(climb / reference, -1, 1);
    const pitch = (dive > 0 ? dive * MAX_DIVE_PITCH : dive * MAX_CLIMB_PITCH) * (1 - landing) - 0.1 * landing;
    const bank = -clamp(this.vx / reference, -1, 1) * Math.min(MAX_BANK, maxBank) * (1 - landing);
    this.pitch += (pitch - this.pitch) * ease(6, delta);
    this.bank += (bank - this.bank) * ease(6, delta);
    // It faces its direction of travel, but never turns its back, however it's moving.
    const travel = clamp(Math.atan2(this.vx, Math.abs(this.vy) + 120), -MAX_FLIGHT_YAW, MAX_FLIGHT_YAW);
    const yaw = speed > 60 ? travel + (spot.faceYaw - travel) * landing : spot.faceYaw;
    this.yaw += wrap(yaw - this.yaw) * ease(5, delta);
  }
}
