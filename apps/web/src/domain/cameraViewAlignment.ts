import type { LandmarkFrame } from "@/types";
export const TRIANGULATION_SYNC_MS = 1000 / 30;
export function nearestCameraFrame(history: LandmarkFrame[], timestamp: number, maximumSkew: number) {
  return history.reduce<LandmarkFrame | null>((best, frame) => Math.abs(frame.timestamp - timestamp) <= maximumSkew
    && (!best || Math.abs(frame.timestamp - timestamp) < Math.abs(best.timestamp - timestamp)) ? frame : best, null);
}
/** Select a bounded time slice containing the primary; do not span two frame periods. */
export function coherentCameraViews<T extends { frame: LandmarkFrame | null }>(views: T[], maximumSkew: number) {
  const primary = views[0]?.frame;
  if (!primary) return [];
  const candidates = views.filter(view => view.frame && Math.abs(view.frame.timestamp - primary.timestamp) <= maximumSkew);
  let best: T[] = [], span = Infinity;
  for (const anchor of candidates) {
    const start = anchor.frame!.timestamp;
    const group = candidates.filter(view => view.frame!.timestamp >= start && view.frame!.timestamp <= start + maximumSkew);
    if (!group.includes(views[0])) continue;
    const width = Math.max(...group.map(v => v.frame!.timestamp)) - Math.min(...group.map(v => v.frame!.timestamp));
    if (group.length > best.length || (group.length === best.length && width < span)) { best = group; span = width; }
  }
  return best;
}
