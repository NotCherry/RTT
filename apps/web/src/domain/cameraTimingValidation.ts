import type { CameraInput } from "./multiCameraContract";
export type CameraTimingValidation = { version: 1; method: "shared-visible-events"; verified_at: string;
  evidence: string; bindings: CameraInput[]; views: { id: string; offsets_ms: number[]; uncertainty_ms: number }[] };
export function validateCameraTiming(value: unknown, inputs: CameraInput[]): CameraTimingValidation {
  const report = value as CameraTimingValidation;
  if (!report || report.version !== 1 || report.method !== "shared-visible-events" || typeof report.evidence !== "string"
    || !report.evidence.trim() || report.evidence.length > 1000 || !Number.isFinite(Date.parse(report.verified_at))
    || JSON.stringify(report.bindings) !== JSON.stringify(inputs) || !Array.isArray(report.views) || report.views.length !== inputs.length)
    throw new Error("Timing report must identify this exact camera setup and retained shared-event evidence.");
  for (const [i, view] of report.views.entries()) {
    if (view.id !== inputs[i].id || !Array.isArray(view.offsets_ms) || view.offsets_ms.length < 5 || view.offsets_ms.length > 60
      || view.offsets_ms.some(offset => !Number.isFinite(offset) || Math.abs(offset) > 500)
      || !Number.isFinite(view.uncertainty_ms) || view.uncertainty_ms < 0 || view.uncertainty_ms > 33.3)
      throw new Error("Use at least five measured event offsets per view and uncertainty up to 33.3 ms.");
    if (i === 0 && view.offsets_ms.some(offset => offset !== 0)) throw new Error("Primary event offsets must be zero.");
    const range = Math.max(...view.offsets_ms)-Math.min(...view.offsets_ms);
    if (range + view.uncertainty_ms*2 > 33.3) throw new Error(`${view.id} timing variability exceeds one 30 Hz frame. Reduce buffering or use synchronized sources.`);
  }
  return structuredClone(report);
}
export function cameraTimingOffset(report: CameraTimingValidation | undefined, id: string) {
  const values = report?.views.find(view => view.id === id)?.offsets_ms;
  return values?.length ? values.reduce((sum, value) => sum+value, 0)/values.length : 0;
}
