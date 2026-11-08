// Ported unchanged from the public Vexora website (src/lib/companion/safe-layout.ts).
// Keeps the character off the page's content. All rectangles are CSS pixels. `flow` rectangles are in
// document coordinates, so they stay valid while scrolling; `pinned` ones (sticky header) are in viewport
// coordinates. Only the scan touches the DOM, so the geometry can be tested without a browser.
import type { GestureClip } from "../bot-animator";

export type Rect = { left: number; top: number; right: number; bottom: number };
export type Scan = { flow: Rect[]; pinned: Rect[]; freeLeft: number; freeRight: number };
type Extent = { side: number; above: number; below: number };

/** Clear space kept around the character and its controls, on every side. */
export const SAFETY_MARGIN = 8;

// Rendered extents in metres from the point between the feet, the widest of every frame at any facing.
// Measured from the canvas pixels of each clip; tests/companion-overlap-qa.mjs re-checks them on screen.
const EXTENTS: Record<string, Extent> = {
  stand: { side: 0.56, above: 1.73, below: 0.07 },
  sit: { side: 0.61, above: 1.72, below: 0.07 },
  Listen: { side: 0.56, above: 1.73, below: 0.07 },
  Think: { side: 0.56, above: 1.73, below: 0.07 },
  Speak: { side: 0.82, above: 1.73, below: 0.07 },
  Wave: { side: 1, above: 1.73, below: 0.07 },
  // Only ever held at the hero's fixed facing, so it doesn't need the any-facing allowance.
  Present: { side: 0.85, above: 1.73, below: 0.07 },
};

export function silhouette(x: number, y: number, pixelsPerMetre: number, pose: "stand" | "sit", gesture: GestureClip | null = null): Rect {
  const body = EXTENTS[pose], arms = gesture ? EXTENTS[gesture] : body;
  const side = Math.max(body.side, arms.side) * pixelsPerMetre;
  return { left: x - side, right: x + side, top: y - body.above * pixelsPerMetre, bottom: y + body.below * pixelsPerMetre };
}

/** The bottom of what's pinned across the top of the viewport, such as the sticky header. A banner pinned lower down isn't a header. */
export const headerBottom = (scan: Scan | null, viewportHeight: number) => scan?.pinned.reduce((lowest, item) => item.top < viewportHeight / 4 ? Math.max(lowest, item.bottom) : lowest, 0) ?? 0;

export const overlaps =(a: Rect, b: Rect, margin = SAFETY_MARGIN) => a.left < b.right + margin && a.right > b.left - margin && a.top < b.bottom + margin && a.bottom > b.top - margin;

/** Whether a viewport rectangle is clear of protected content at this scroll position. */
export function isClear(rect: Rect, scan: Scan, scrollY: number) {
  const inDocument = { left: rect.left, right: rect.right, top: rect.top + scrollY, bottom: rect.bottom + scrollY };
  return !scan.flow.some(item => overlaps(inDocument, item)) && !scan.pinned.some(item => overlaps(rect, item));
}

/** Clear width at each edge of the viewport over the page's whole length, which no scrolling can change. */
export function freeColumns(flow: Rect[], pinned: Rect[], viewportWidth: number) {
  const all = [...flow, ...pinned];
  const freeLeft = all.reduce((space, item) => Math.min(space, item.left), viewportWidth);
  const freeRight = all.reduce((space, item) => Math.min(space, viewportWidth - item.right), viewportWidth);
  return { freeLeft: Math.max(0, freeLeft), freeRight: Math.max(0, freeRight) };
}

// Media is protected as a whole box, not just its text: the playing demo is a figure, and its gaps aren't open space.
const INTERACTIVE = "a,button,input,select,textarea,summary,label,img,video,canvas,figure,iframe,[role=button],[role=tab],[role=link],[role=slider],[contenteditable=true]";
const SKIPPED_TEXT = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"]);
// The hero's animated scene is decoration. Its pieces travel, so none of them can be a fixed obstacle.
const DECORATIVE = "[data-hero-visual]";

const isHidden = (element: Element) => {
  const style = getComputedStyle(element);
  return style.visibility === "hidden" || style.display === "none" || Number(style.opacity) === 0;
};

/** Trims a rectangle to what its clipping ancestors actually show. Null means nothing is visible. */
function clipped(rect: DOMRect | Rect, element: Element, clips: Map<Element, Rect | null>): Rect | null {
  const clip = clipFor(element, clips);
  if (clip === null) return null;
  const left = Math.max(rect.left, clip.left), right = Math.min(rect.right, clip.right), top = Math.max(rect.top, clip.top), bottom = Math.min(rect.bottom, clip.bottom);
  return right - left < 2 || bottom - top < 2 ? null : { left, right, top, bottom };
}

function clipFor(element: Element | null, clips: Map<Element, Rect | null>): Rect | null {
  const unbounded = { left: -Infinity, right: Infinity, top: -Infinity, bottom: Infinity };
  if (!element || element === document.documentElement || element === document.body) return unbounded;
  const known = clips.get(element);
  if (known !== undefined) return known;
  const parent = clipFor(element.parentElement, clips);
  let result = parent;
  if (parent) {
    const style = getComputedStyle(element);
    const clipsX = style.overflowX !== "visible", clipsY = style.overflowY !== "visible";
    if (style.display === "none" || style.position === "fixed") result = style.display === "none" ? null : unbounded;
    else if (clipsX || clipsY) {
      const box = element.getBoundingClientRect();
      result = { left: clipsX ? Math.max(parent.left, box.left) : parent.left, right: clipsX ? Math.min(parent.right, box.right) : parent.right, top: clipsY ? Math.max(parent.top, box.top) : parent.top, bottom: clipsY ? Math.min(parent.bottom, box.bottom) : parent.bottom };
      if (result.right <= result.left || result.bottom <= result.top) result = null;
    }
  }
  clips.set(element, result);
  return result;
}

const isPinned = (element: Element, pinned: Map<Element, boolean>): boolean => {
  if (element === document.documentElement || element === document.body) return false;
  const known = pinned.get(element);
  if (known !== undefined) return known;
  const position = getComputedStyle(element).position;
  const result = position === "fixed" || position === "sticky" || (element.parentElement ? isPinned(element.parentElement, pinned) : false);
  pinned.set(element, result);
  return result;
};

// A section waiting to fade in is drawn lower than where it settles, so its content is protected in both places.
// Only the reveal's own movement counts: the section and its staggered children, not animations inside them.
const REVEALING = "[data-reveal]", REVEAL_MOVES = "[data-reveal], [data-stagger] > *";

/** How far down an element is drawn by transforms that its section's reveal will undo. */
const revealShift = (element: Element | null, shifts: Map<Element, number>): number => {
  if (!element || element === document.body || element === document.documentElement) return 0;
  const known = shifts.get(element);
  if (known !== undefined) return known;
  const section = element.closest(REVEALING);
  let result = 0;
  if (section) {
    const transform = element.matches(REVEAL_MOVES) ? getComputedStyle(element).transform : "none";
    result = (transform && transform !== "none" ? new DOMMatrixReadOnly(transform).m42 : 0) + (element === section ? 0 : revealShift(element.parentElement, shifts));
  }
  shifts.set(element, result);
  return result;
};

/** Finds every piece of visible text and every interactive element, ignoring the companion itself. */
export function scanProtected(companion: Element): Scan {
  const flow: Rect[] = [], pinned: Rect[] = [];
  const clips = new Map<Element, Rect | null>(), pinnedElements = new Map<Element, boolean>(), shifts = new Map<Element, number>();
  const add = (box: DOMRect, element: Element) => {
    const visible = clipped(box, element, clips);
    if (!visible) return;
    // Off-screen tricks such as the skip link sit outside the page until focused.
    if (visible.right <= 0 || visible.left >= innerWidth || visible.bottom + scrollY <= 0) return;
    if (isPinned(element, pinnedElements)) { pinned.push(visible); return; }
    const shift = revealShift(element, shifts);
    flow.push({ left: visible.left, right: visible.right, top: visible.top + scrollY - Math.max(0, shift), bottom: visible.bottom + scrollY - Math.min(0, shift) });
  };
  for (const element of document.querySelectorAll(INTERACTIVE)) {
    if (companion.contains(element) || element.closest(DECORATIVE) || isHidden(element)) continue;
    add(element.getBoundingClientRect(), element);
  }
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement;
    if (!parent || !node.textContent?.trim() || SKIPPED_TEXT.has(parent.tagName) || companion.contains(parent) || parent.closest(DECORATIVE) || isHidden(parent)) continue;
    range.selectNodeContents(node);
    for (const box of range.getClientRects()) add(box, parent);
  }
  return { flow, pinned, ...freeColumns(flow, pinned, innerWidth) };
}

export type Dock = { kind: "gutter"; side: "left" | "right"; width: number } | { kind: "bar" };

// Below this, the character would be too small to read in a side column, so it uses the reserved bar.
const MIN_GUTTER = 88;
const MIN_GUTTER_HEIGHT = 620;

/** Uses a side column only when one is genuinely empty for the whole page; otherwise a reserved bar. */
export function chooseDock(scan: Scan, viewportHeight: number): Dock {
  if (viewportHeight < MIN_GUTTER_HEIGHT) return { kind: "bar" };
  if (scan.freeLeft >= MIN_GUTTER && scan.freeLeft >= scan.freeRight - 40) return { kind: "gutter", side: "left", width: scan.freeLeft };
  if (scan.freeRight >= MIN_GUTTER) return { kind: "gutter", side: "right", width: scan.freeRight };
  if (scan.freeLeft >= MIN_GUTTER) return { kind: "gutter", side: "left", width: scan.freeLeft };
  return { kind: "bar" };
}
