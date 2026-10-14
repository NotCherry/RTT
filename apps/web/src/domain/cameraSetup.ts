import { parseCameraCalibration, type CameraCalibration, type CameraInput, type PoseFusionModel } from "./multiCameraContract";
import type { CameraDetectorModel } from "./cameraDetectorModels";
import { validateCameraTiming, type CameraTimingValidation } from "./cameraTimingValidation";
import type { RetargetingProfile } from "./retargeting";

export type CameraSetup = { version: 1; name: string; inputs: CameraInput[]; model: PoseFusionModel; detector?: CameraDetectorModel; calibration?: CameraCalibration; timing?: CameraTimingValidation; profile?: RetargetingProfile };
export const defaultCameraInputs = (): CameraInput[] => [1, 2, 3].map(i => ({ id: `view-${i}`, kind: "local", deviceId: "", address: "" }));
const storageKey = (robotId: string) => `rtt-camera-setup-v1:${robotId}`;
export function loadCameraSetup(robotId?: string): CameraSetup | null {
  if (!robotId) return null;
  try {
    const setup = JSON.parse(localStorage.getItem(storageKey(robotId)) ?? "null") as CameraSetup | null;
    if (!setup || setup.version !== 1 || typeof setup.name !== "string" || !Array.isArray(setup.inputs)
      || setup.inputs.length < 1 || setup.inputs.length > 3 || !["body-aligned", "triangulated"].includes(setup.model)) return null;
    if (setup.inputs.some((input, i) => input.id !== `view-${i + 1}` || !["local", "ip"].includes(input.kind)
      || typeof input.deviceId !== "string" || typeof input.address !== "string")) return null;
    if (setup.detector && !["holistic", "pose"].includes(setup.detector)) return null;
    if (setup.calibration) setup.calibration = parseCameraCalibration(setup.calibration);
    if (setup.timing) setup.timing = validateCameraTiming(setup.timing, setup.inputs);
    if (setup.profile && !["g1-left-arm", "g1-single-arm", "g1-upper-body", "g1-full-body"].includes(setup.profile)) return null;
    return setup;
  } catch { return null; }
}
export function saveCameraSetup(robotId: string, setup: CameraSetup) {
  localStorage.setItem(storageKey(robotId), JSON.stringify(setup));
}
