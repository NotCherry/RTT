import type { RobotConnectionConfig } from "./robotTransport";
export type RobotConnectionSettings = RobotConnectionConfig & { motion_profile?: "custom" | "match-preview" };
const key = "rtt-robot-connection-v1";
export function loadRobotConnectionSettings(): RobotConnectionSettings {
  const defaults: RobotConnectionSettings = { transport: "unitree-sdk2", robot_model: "g1-29", network_interface: "eth0", domain_id: 0,
    max_joint_speed: 1, max_joint_acceleration: 3, kp: 60, kd: 1.5, waist_dof: 3, allow_multicast: true, discovery_peers: [] };
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? "null") as RobotConnectionSettings | null;
    if (!saved || !["unitree-sdk2", "mock", "unitree-rosbridge"].includes(saved.transport) || !["g1-29", "g1-23"].includes(saved.robot_model)
      || !/^[a-zA-Z0-9_.:-]{1,64}$/.test(saved.network_interface) || !Number.isInteger(saved.domain_id) || saved.domain_id < 0 || saved.domain_id > 232
      || ![.5, 1, 1.5, 2, 3].includes(saved.max_joint_speed) || !Number.isFinite(saved.max_joint_acceleration) || saved.max_joint_acceleration <= 0 || saved.max_joint_acceleration > 10
      || ![20,40,60].includes(saved.kp ?? 60) || ![1,3].includes(saved.waist_dof ?? 3)
      || (saved.robot_model === "g1-23" && saved.waist_dof !== 1) || typeof saved.allow_multicast !== "boolean"
      || !Array.isArray(saved.discovery_peers) || saved.discovery_peers.length > 16
      || saved.discovery_peers.some(peer => typeof peer !== "string" || !/^(\d{1,3}\.){3}\d{1,3}$/.test(peer) || peer.split(".").some(part => Number(part) > 255))) return defaults;
    if (saved.transport === "unitree-rosbridge") {
      const url = new URL(saved.rosbridge_url ?? "");
      if (!["ws:", "wss:"].includes(url.protocol) || url.username || url.password) return defaults;
    }
    return { ...defaults, ...saved };
  } catch { return defaults; }
}
export function saveRobotConnectionSettings(settings: RobotConnectionSettings) {
  try { localStorage.setItem(key, JSON.stringify(settings)); } catch { /* Running control remains available when storage is disabled. */ }
}
