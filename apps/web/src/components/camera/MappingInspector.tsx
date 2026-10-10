import { mappingCoverage, type RetargetingProfile } from "@/domain/retargeting";
import type { Joint, LandmarkFrame } from "@/types";

export function MappingInspector({ frame, joints, profile }: {
  frame: LandmarkFrame | null; joints: Joint[]; profile: RetargetingProfile;
}) {
  const coverage = mappingCoverage(frame, joints, profile);
  const label = (names: string[]) => names.map((name) => name.replace(/_joint$/, "").replaceAll("_", " ")).join(", ");
  return <details className="camera-mapping-inspector">
    <summary>Mapping coverage · {coverage.mapped.length} mapped · {coverage.neutral.length} neutral</summary>
    <p className="helper-text">{frame?.multi_view
      ? `${frame.multi_view.contributing_views.length} contributing views · ${frame.multi_view.model==="triangulated" ? `${frame.multi_view.triangulated_landmarks} reconstructed landmarks` : `${frame.multi_view.fused_landmarks} fused landmarks · estimated depth`}.`
      : coverage.hasDepth ? "3D body landmarks available." : "2D landmarks: depth rotations stay neutral."} Only visible, compatible joints move; hidden joints and unobservable wrist twist stay neutral.</p>
    {frame && coverage.torsoReference === "shoulders" && <p className="helper-text">Hips are hidden: visible arms still map using a shoulder reference. Torso motion stays neutral.</p>}
    <p className="helper-text"><strong>Mapped now:</strong> {label(coverage.mapped) || "None — show a limb clearly or choose a compatible robot."}</p>
    <p className="helper-text"><strong>Neutral:</strong> {label(coverage.neutral) || "None"}</p>
  </details>;
}
