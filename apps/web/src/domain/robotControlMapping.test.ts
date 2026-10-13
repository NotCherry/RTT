import { expect, it } from "vitest";
import { controlForProfile, selectRobotTargets } from "./robotControlMapping";
import type { RobotConnectionConfig } from "./robotTransport";
const config: RobotConnectionConfig = { transport: "mock", network_interface: "lo", domain_id: 0,
  robot_model: "g1-29", max_joint_speed: 1, max_joint_acceleration: 3, waist_dof: 3 };
const targets = { left_elbow_joint: .2, right_elbow_joint: .4, waist_yaw_joint: .1,
  waist_roll_joint: .1, waist_pitch_joint: .1, right_hip_pitch_joint: .3 };

it("uses the mapping scope for physical single-arm ownership and excludes torso and other arm targets", () => {
  expect(selectRobotTargets(targets, { ...config, ...controlForProfile("g1-single-arm") })).toEqual({ right_elbow_joint: .4 });
  expect(selectRobotTargets(targets, { ...config, ...controlForProfile("g1-left-arm") })).toEqual({ left_elbow_joint: .2 });
});
it("sends both arms and all available waist axes without legs", () => {
  const { right_hip_pitch_joint: _, ...upper } = targets;
  expect(selectRobotTargets(targets, { ...config, ...controlForProfile("g1-upper-body") })).toEqual(upper);
  expect(selectRobotTargets(targets, { ...config, ...controlForProfile("g1-full-body"), waist_dof: 1 }))
    .toEqual({ left_elbow_joint: .2, right_elbow_joint: .4, waist_yaw_joint: .1 });
});
it("holds missing channels and excludes wrist axes unavailable on the selected robot", () => {
  expect(selectRobotTargets({ waist_pitch_joint: .1 }, { ...config, control_mode: "single-arm" })).toBeNull();
  expect(selectRobotTargets({ right_wrist_pitch_joint: .1 }, { ...config, robot_model: "g1-23" })).toBeNull();
  expect(selectRobotTargets(null, config)).toBeNull();
});
