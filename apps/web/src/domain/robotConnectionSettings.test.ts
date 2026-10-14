// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { loadRobotConnectionSettings, saveRobotConnectionSettings } from "./robotConnectionSettings";
afterEach(() => localStorage.clear());
it("starts with physical DDS defaults and restores explicit network settings without connection intent", () => {
  const defaults = loadRobotConnectionSettings();
  expect(defaults).toMatchObject({ transport: "unitree-sdk2", network_interface: "eth0", max_joint_speed: 1 });
  saveRobotConnectionSettings({ ...defaults, network_interface: "eth1", domain_id: 7, discovery_peers: ["192.168.1.2"], allow_multicast: false });
  expect(loadRobotConnectionSettings()).toMatchObject({ network_interface: "eth1", domain_id: 7, allow_multicast: false });
});
it("rejects malformed saved robot contracts", () => {
  saveRobotConnectionSettings({ ...loadRobotConnectionSettings(), max_joint_speed: 99 });
  expect(loadRobotConnectionSettings().max_joint_speed).toBe(1);
});
