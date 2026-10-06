import { describe, expect, it } from "vitest";
import { Euler, Matrix4, Quaternion, Vector3 } from "three";
import type { LandmarkFrame } from "@/types";
import { g1ArmJoints } from "./fixtures/g1ArmJoints";
import { retargetLandmarkFrame } from "./retargeting";

function observation(): LandmarkFrame {
  const pose = Array.from({ length: 33 }, () => ({ x: .5, y: .5, z: 0, visibility: 0 }));
  for (const [index, x, y] of [[11,.65,.2], [12,.35,.2], [13,.65,.4], [14,.35,.4], [15,.65,.6], [16,.35,.6], [23,.6,.5], [24,.4,.5]]) {
    pose[index] = { x, y, z: 0, visibility: 1 };
  }
  return { timestamp: 0, pose, pose_world: pose.map(p => ({ ...p })), left_hand: [], right_hand: [], confidence: 1 };
}
/** Independent forward kinematics using the actual G1 joint origins and axes. */
function forearmDirection(side: "left" | "right", positions: number[]) {
  const world = new Matrix4();
  let elbow = new Vector3();
  let wrist = new Vector3();
  for (const [index, joint] of g1ArmJoints.entries()) {
    if (!joint.name.startsWith(side)) continue;
    const [r, p, y] = joint.origin.rpy;
    world.multiply(new Matrix4().compose(new Vector3(...joint.origin.xyz), new Quaternion().setFromEuler(new Euler(r, p, y, "ZYX")), new Vector3(1, 1, 1)));
    if (joint.name.endsWith("elbow_joint")) elbow = new Vector3().setFromMatrixPosition(world);
    if (joint.name.endsWith("wrist_roll_joint")) wrist = new Vector3().setFromMatrixPosition(world);
    world.multiply(new Matrix4().makeRotationAxis(new Vector3(...joint.axis), positions[index]));
  }
  return wrist.sub(elbow).normalize();
}

describe.each(["left", "right"] as const)("G1 %s arm replay", (side) => {
  const elbow = side === "left" ? 13 : 14;
  const wrist = side === "left" ? 15 : 16;
  const map = (frame: LandmarkFrame) => retargetLandmarkFrame(frame, g1ArmJoints, g1ArmJoints.map(() => 0), "g1-full-body");
  it("replays straight hanging arms downward rather than bending the hands forward", () => {
    expect(forearmDirection(side, map(observation())).dot(new Vector3(0, 0, -1))).toBeGreaterThan(.99);
  });
  it("replays a forward elbow bend forward rather than down or backward", () => {
    const frame = observation();
    frame.pose_world![wrist] = { ...frame.pose_world![elbow], z: -.2 };
    expect(forearmDirection(side, map(frame)).dot(new Vector3(1, 0, 0))).toBeGreaterThan(.99);
  });
  it("raises the whole arm forward without the G1 shoulder cant pushing it sideways", () => {
    const frame = observation();
    const shoulder = side === "left" ? 11 : 12;
    frame.pose_world![elbow] = { ...frame.pose_world![shoulder], z: -.2 };
    frame.pose_world![wrist] = { ...frame.pose_world![shoulder], z: -.4 };
    expect(forearmDirection(side, map(frame)).dot(new Vector3(1, 0, 0))).toBeGreaterThan(.99);
  });
  it("keeps each anatomical arm on its own side during a lateral raise", () => {
    const frame = observation();
    const shoulder = side === "left" ? 11 : 12;
    const direction = side === "left" ? 1 : -1;
    frame.pose_world![elbow] = { ...frame.pose_world![shoulder], x: frame.pose_world![shoulder].x + direction * .2 };
    frame.pose_world![wrist] = { ...frame.pose_world![elbow], x: frame.pose_world![elbow].x + direction * .2 };
    expect(forearmDirection(side, map(frame)).dot(new Vector3(0, direction, 0))).toBeGreaterThan(.99);
  });
  it("uses shoulder yaw to replay a raised upper arm with its forearm pointing down", () => {
    const frame = observation();
    const shoulder = side === "left" ? 11 : 12;
    const direction = side === "left" ? 1 : -1;
    frame.pose_world![elbow] = { ...frame.pose_world![shoulder], x: frame.pose_world![shoulder].x + direction * .2 };
    frame.pose_world![wrist] = { ...frame.pose_world![elbow], y: frame.pose_world![elbow].y + .2 };
    expect(forearmDirection(side, map(frame)).dot(new Vector3(0, 0, -1))).toBeGreaterThan(.99);
  });
});

it("replays combined torso turn, lean, and bend in the G1 waist joint order", () => {
  const frame = observation();
  const yaw = -.2, roll = -.3, pitch = .25;
  const turn = new Matrix4().makeRotationZ(yaw).multiply(new Matrix4().makeRotationX(roll)).multiply(new Matrix4().makeRotationY(pitch));
  for (const index of [11, 12, 13, 14, 15, 16]) {
    const p = frame.pose_world![index];
    const v = new Vector3(-p.z, p.x - .5, .5 - p.y).applyMatrix4(turn);
    frame.pose_world![index] = { ...p, x: v.y + .5, y: .5 - v.z, z: -v.x };
  }
  const joints = ["waist_yaw_joint", "waist_roll_joint", "waist_pitch_joint"].map(name => ({ ...g1ArmJoints[0], name, lower: -1, upper: 1 }));
  const output = retargetLandmarkFrame(frame, joints, [0, 0, 0], "g1-full-body");
  expect(output[0]).toBeCloseTo(yaw, 5);
  expect(output[1]).toBeCloseTo(roll, 5);
  expect(output[2]).toBeCloseTo(pitch, 5);
});
it("maps observable wrist bending and sideways motion while ignoring hidden fingertips", () => {
  const frame = observation();
  const wrist = frame.pose_world![15];
  frame.pose[17] = frame.pose[19] = { x: .65, y: .7, z: 0, visibility: 1 };
  frame.pose_world![17] = frame.pose_world![19] = { ...wrist, z: -.1 };
  const joints = ["left_wrist_pitch_joint", "left_wrist_yaw_joint"].map(name => ({ ...g1ArmJoints[0], name, lower: -2, upper: 2 }));
  const output = retargetLandmarkFrame(frame, [...g1ArmJoints, ...joints], Array(12).fill(0), "g1-full-body");
  expect(output[10]).toBeCloseTo(-Math.PI / 2, 2);
  expect(output[11]).toBeCloseTo(0, 2);
  frame.pose_world![17] = frame.pose_world![19] = { ...wrist, x: wrist.x + .1, y: wrist.y + .001, z: -.001 };
  const sideways = retargetLandmarkFrame(frame, [...g1ArmJoints, ...joints], Array(12).fill(0), "g1-full-body");
  expect(Math.abs(sideways[10])).toBeLessThan(.01);
  expect(sideways[11]).toBeCloseTo(Math.PI / 2, 1);
  frame.pose[19].visibility = .1;
  const hidden = retargetLandmarkFrame(frame, [...g1ArmJoints, ...joints], Array(12).fill(.1), "g1-full-body");
  expect(hidden.slice(10)).toEqual([.1, .1]);
});
