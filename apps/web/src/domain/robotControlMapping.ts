import type { RetargetingProfile } from "./retargeting";
import type { RobotConnectionConfig } from "./robotTransport";

export function controlForProfile(profile: RetargetingProfile) {
  return profile === "g1-single-arm" || profile === "g1-left-arm"
    ? { control_mode: "single-arm" as const, active_arm: profile === "g1-left-arm" ? "left" as const : "right" as const }
    : { control_mode: "upper-body" as const, active_arm: "right" as const };
}

export function selectRobotTargets(positions: Record<string, number> | null, config: RobotConnectionConfig | null) {
  if (!positions || !config) return null;
  const mode = config.control_mode ?? "arms";
  const selected = Object.fromEntries(Object.entries(positions).filter(([name]) => {
    if (/^waist_(yaw|roll|pitch)_joint$/.test(name)) {
      return mode === "upper-body" && (config.waist_dof === 3 || name === "waist_yaw_joint");
    }
    if (!/^(left|right)_(shoulder_(pitch|roll|yaw)|elbow|wrist_(roll|pitch|yaw))_joint$/.test(name)) return false;
    if (config.robot_model === "g1-23" && /wrist_(pitch|yaw)_joint$/.test(name)) return false;
    return mode !== "single-arm" || name.startsWith(`${config.active_arm ?? "right"}_`);
  }));
  return Object.keys(selected).length ? selected : null;
}
