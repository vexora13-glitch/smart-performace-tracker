// Portal adaptation of the website's stations (src/lib/companion/stations.ts). Decides where the character
// belongs for the current portal page and viewport. The open-panel and reserved-bar placements are the
// original's. The website's hero and side-column placements are replaced by the portal's sidebar perch: an
// empty area the fixed sidebar reserves between its navigation and its account block. Every spot is checked
// against the page's content. If none is clear, the character collapses and the controls remain.
import type { GestureClip } from "../bot-animator";
import type { CompanionTarget } from "./director";
import type { Corridor } from "./flight.ts";
import { isClear, silhouette, SAFETY_MARGIN, type Rect, type Scan } from "./safe-layout.ts";

export type PortalPage = "Dashboard" | "Clients" | "Messages" | "Workspace" | "Vexbot";
type Station = { at: number; rest?: "stand" | "sit"; gesture?: GestureClip | null; faceYaw?: number };

// Where along the perch it stands on each page (0 is the left edge, 1 the right) and how it behaves there.
// Moving between pages is a short hop along the perch, so it is walked at the original foot-locked cadence.
const STATIONS: Record<PortalPage, Station> = {
  Dashboard: { at: 0.34, gesture: "Wave", faceYaw: 0.45 },
  Clients: { at: 0.64, gesture: "Think", faceYaw: 0.35 },
  Workspace: { at: 0.5, faceYaw: 0.4 },
  // Messages need concentration, so it sits down out of the way, as it does beside the website's form.
  Messages: { at: 0.6, rest: "sit", faceYaw: 0.45 },
  Vexbot: { at: 0.42, gesture: "Listen", faceYaw: 0.3 },
};

const STANDING_METRES = 1.72;
const PERCH_MAX_PIXELS = 350;
const PERCH_MIN_PIXELS = 96;
const MIN_PERCH_WIDTH = 150;
const MIN_PERCH_HEIGHT = 116;
export const BAR_ROBOT_PIXELS = 60;
export const MIN_BAR_VIEWPORT = 420;

export type PortalDock = { kind: "perch"; rect: Rect } | { kind: "bar" };
export type Placement = { target: CompanionTarget; shown: boolean; pixelsPerMetre: number };

export type Layout = {
  viewportWidth: number;
  viewportHeight: number;
  /** Pixels per metre at scale 1, which is what the canvas renders at. */
  canvasPixelsPerMetre: number;
  scan: Scan | null;
  scrollY: number;
  dock: PortalDock;
  /** The reserved character area inside an open assistant panel. */
  panelStage: Rect | null;
  /** A voice turn is being recorded or played, so the character stays where it is. */
  conversation: boolean;
  page: PortalPage;
};

/** The perch when the sidebar has room for a readable character; otherwise the website's reserved bar. */
export function choosePortalDock(perch: Rect | null, viewportHeight: number): PortalDock {
  if (perch && perch.right - perch.left >= MIN_PERCH_WIDTH && perch.bottom - perch.top >= MIN_PERCH_HEIGHT && viewportHeight >= 560) return { kind: "perch", rect: perch };
  return { kind: "bar" };
}

/** The flight strip for the perch dock. The bar dock uses the original measured corridor instead. */
export function perchStrip(dock: PortalDock): Corridor | null {
  return dock.kind === "perch" ? { ...dock.rect, bar: false } : null;
}

function fitGesture(gesture: GestureClip | null, x: number, y: number, pixelsPerMetre: number, pose: "stand" | "sit", scan: Scan | null, scrollY: number) {
  if (!gesture || !scan) return gesture;
  return isClear(silhouette(x, y, pixelsPerMetre, pose, gesture), scan, scrollY) ? gesture : null;
}

export function stationTarget(layout: Layout): Placement {
  const { viewportHeight, canvasPixelsPerMetre, scan, scrollY, dock, panelStage, conversation, page } = layout;
  const place = (key: string, x: number, y: number, pixelsPerMetre: number, shown: boolean, rest: "stand" | "sit", gesture: GestureClip | null, faceYaw: number, instant = false): Placement => ({
    shown, pixelsPerMetre,
    target: { key, x, y, scale: pixelsPerMetre / canvasPixelsPerMetre, rest, gesture, faceYaw, instant },
  });

  // The assistant is open: the character moves into the panel's own reserved area, off the page entirely.
  if (panelStage) {
    const pixels = panelStage.bottom - panelStage.top - 12, pixelsPerMetre = pixels / STANDING_METRES;
    return place("panel", (panelStage.left + panelStage.right) / 2, panelStage.bottom - 0.07 * pixelsPerMetre - 2, pixelsPerMetre, pixels >= 40, "stand", null, 0.3, true);
  }

  const station = STATIONS[page];
  const rest = conversation ? "stand" : station.rest ?? "stand";
  const yaw = station.faceYaw ?? 0.35;
  const key = conversation ? `${page}:talk` : `${page}:${dock.kind}`;

  if (dock.kind === "bar") {
    const pixelsPerMetre = BAR_ROBOT_PIXELS / (STANDING_METRES + 0.07);
    const x = 8 + 0.56 * pixelsPerMetre, y = viewportHeight - 0.07 * pixelsPerMetre - 4;
    const room = viewportHeight >= MIN_BAR_VIEWPORT;
    return place(key, x, y, pixelsPerMetre, room, rest, conversation ? null : station.gesture ?? null, yaw);
  }

  // The perch. Sized to fit at its widest ordinary pose and its full height, feet on the perch's floor.
  const perch = dock.rect;
  // Reserve the flight silhouette as well as the standing pose, plus room for short page-to-page hops.
  const widest = 0.66;
  const usable = perch.right - perch.left - SAFETY_MARGIN * 2 - 32;
  const tall = perch.bottom - perch.top - SAFETY_MARGIN * 2;
  const pixels = Math.min(PERCH_MAX_PIXELS, (usable / (widest * 2)) * STANDING_METRES, (tall * STANDING_METRES) / 1.8);
  const pixelsPerMetre = pixels / STANDING_METRES;
  const side = widest * pixelsPerMetre + SAFETY_MARGIN;
  const wanted = perch.left + station.at * (perch.right - perch.left);
  const x = Math.min(perch.right - side, Math.max(perch.left + side, wanted));
  const y = perch.bottom - SAFETY_MARGIN - 0.07 * pixelsPerMetre;
  const gesture = conversation ? null : fitGesture(station.gesture ?? null, x, y, pixelsPerMetre, rest, scan, scrollY);
  return place(key, x, y, pixelsPerMetre, pixels >= PERCH_MIN_PIXELS, rest, gesture, yaw);
}
