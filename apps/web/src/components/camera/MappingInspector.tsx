import { mappingCoverage, type RetargetingProfile } from "@/domain/retargeting";
import type { Joint, LandmarkFrame } from "@/types";

export function MappingInspector({ frame, joints, profile }: {
  frame: LandmarkFrame | null; joints: Joint[]; profile: RetargetingProfile;
}) {
  const coverage = mappingCoverage(frame, joints, profile);
  const label = (names: string[]) => names.map((name) => name.replace(/_joint$/, "").replaceAll("_", " ")).join(", ");
  return <details className="camera-mapping-inspector">
    <summary>Mapping coverage · {coverage.mapped.length} mapped · {coverage.neutral.length} neutral</summary>
    <p className="helper-text">{coverage.hasDepth ? "3D body landmarks available." : "2D landmarks: depth rotations stay neutral."} Hidden landmarks, torso twist and wrist rotations retain the neutral pose.</p>
    <p className="helper-text"><strong>Mapped now:</strong> {label(coverage.mapped) || "None — show your shoulders and hips to the camera."}</p>
    <p className="helper-text"><strong>Neutral:</strong> {label(coverage.neutral) || "None"}</p>
  </details>;
}
