import type { CameraRig } from "@/components/camera/CameraRigControls";
export type BoardSettings = { columns: number; rows: number; square_m: number; marker_m: number };
export type BoardObservation = { id: string; width: number; height: number; ids: number[]; points: [number, number][] };
export const defaultBoard: BoardSettings = { columns: 10, rows: 7, square_m: .025, marker_m: .018 };
export function captureCalibrationImages(rig: CameraRig) {
  return rig.inputs.map((input, i) => {
    const source = input.kind === "local" ? rig.cameras[i].videoRef.current : rig.cameras[i].imageRef.current;
    if (!source) throw new Error(`Camera ${i + 1} preview is unavailable`);
    const width = source instanceof HTMLVideoElement ? source.videoWidth : source.naturalWidth;
    const height = source instanceof HTMLVideoElement ? source.videoHeight : source.naturalHeight;
    if (!width || !height || Math.max(width, height) > 4096) throw new Error(`Camera ${i + 1} needs a valid resolution up to 4096 pixels`);
    const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
    const context = canvas.getContext("2d"); if (!context) throw new Error("Snapshot capture is unavailable");
    context.drawImage(source, 0, 0);
    return { id: input.id, jpeg: canvas.toDataURL("image/jpeg", .8).split(",")[1] };
  });
}
