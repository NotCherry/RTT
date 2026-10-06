import type { RetargetingProfile } from "@/domain/retargeting";

export function MappingControls({ profile, disabled, onChange }: {
  profile: RetargetingProfile; disabled: boolean; onChange: (profile: RetargetingProfile) => void;
}) {
  const single = profile === "g1-single-arm" || profile === "g1-left-arm";
  return <div className="route-form-grid camera-mapping-controls">
    <label>Mapping scope
      <select aria-label="Mapping scope" disabled={disabled} value={single ? "single" : profile} onChange={(event) => onChange(event.target.value === "single" ? "g1-single-arm" : event.target.value as RetargetingProfile)}>
        <option value="g1-upper-body">Upper body</option><option value="g1-full-body">Full body</option><option value="single">Single arm</option>
      </select>
    </label>
    {single && <label>Arm selection
      <select aria-label="Arm selection" disabled={disabled} value={profile} onChange={(event) => onChange(event.target.value as RetargetingProfile)}>
        <option value="g1-single-arm">Right arm</option><option value="g1-left-arm">Left arm</option>
      </select>
    </label>}
    <p className="helper-text">Left and right refer to the person’s own body. Only visible, compatible G1 joints move.</p>
  </div>;
}
