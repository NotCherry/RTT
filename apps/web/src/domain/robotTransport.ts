import { robotTransportRequest, robotTransportSocketUrl } from "@/api";
import type { Joint } from "@/types";
export type RobotConnectionConfig = {
  transport: "mock" | "unitree-sdk2" | "unitree-rosbridge";
  robot_model: "g1-29" | "g1-23";
  network_interface: string;
  domain_id: number;
  max_joint_speed: number;
  max_joint_acceleration: number;
  kp?: number;
  kd?: number;
  rosbridge_url?: string;
  discovery_peers?: string[];
  allow_multicast?: boolean;
  control_mode?: "arms" | "single-arm" | "upper-body";
  active_arm?: "left" | "right";
  waist_dof?: 1 | 3;
};
export type RobotTransportStatus = {
  connected: boolean;
  armed: boolean;
  transport: "mock" | "unitree-sdk2" | "unitree-rosbridge" | null;
  state_fresh: boolean;
  reason: string;
  measured: Record<string, number>;
  commanded: Record<string, number>;
  packets_sent: number;
  engagement: number;
  stream_connected: boolean;
  targets_received: number;
  camera_target: Record<string, number>;
  control_mode?: RobotConnectionConfig["control_mode"] | null;
  active_arm?: "left" | "right" | null;
  waist_dof?: 1 | 3 | null;
  arm_kp?: number | null;
  last_stream_error?: string | null;
};
export const getRobotTransportStatus = () => robotTransportRequest<RobotTransportStatus>("status");
export const connectRobotTransport = (config: RobotConnectionConfig) =>
  robotTransportRequest<RobotTransportStatus & { token: string; joint_contract?: Joint[] }>("connect", config);
export const robotTransportAction = (action: "arm" | "disarm" | "disconnect", token: string) =>
  robotTransportRequest<RobotTransportStatus>(action, {}, { "X-Robot-Token": token });
export const createRobotTargetSocket = () => new WebSocket(robotTransportSocketUrl());
