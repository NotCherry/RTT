import { robotTransportRequest, robotTransportSocketUrl } from "@/api";
export type RobotConnectionConfig = {
  transport: "mock" | "unitree-sdk2";
  robot_model: "g1-29" | "g1-23";
  network_interface: string;
  domain_id: number;
  max_joint_speed: number;
  max_joint_acceleration: number;
};
export type RobotTransportStatus = {
  connected: boolean;
  armed: boolean;
  transport: "mock" | "unitree-sdk2" | null;
  state_fresh: boolean;
  reason: string;
  measured: Record<string, number>;
  commanded: Record<string, number>;
  packets_sent: number;
  engagement: number;
};
export const getRobotTransportStatus = () => robotTransportRequest<RobotTransportStatus>("status");
export const connectRobotTransport = (config: RobotConnectionConfig, key: string) =>
  robotTransportRequest<RobotTransportStatus & { token: string }>("connect", config, { "X-Robot-Control-Key": key });
export const robotTransportAction = (action: "arm" | "disarm" | "disconnect", token: string) =>
  robotTransportRequest<RobotTransportStatus>(action, {}, { "X-Robot-Token": token });
export const createRobotTargetSocket = () => new WebSocket(robotTransportSocketUrl());
