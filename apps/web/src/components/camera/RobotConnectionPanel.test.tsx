// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { RobotConnectionPanel } from "./RobotConnectionPanel";
afterEach(cleanup);
const connection = () => ({ status: null, owned: false, streamReady: false, busy: false, error: "", connect: vi.fn(), action: vi.fn(), submit: vi.fn() });
const connected = { connected: true, armed: false, transport: "mock" as const, state_fresh: true, reason: "Connected", measured: { left_elbow_joint: .2 }, commanded: {}, packets_sent: 0, engagement: 0, stream_connected: true, targets_received: 12, camera_target: { left_elbow_joint: .5 } };
it("offers a mock connection and distinct hardware speed", () => {
  const c = connection();
  render(<RobotConnectionPanel connection={c} live={false} />);
  fireEvent.change(screen.getByLabelText("Robot speed"), { target: { value: "1.5" } });
  fireEvent.click(screen.getByRole("button", { name: "Connect mock robot" }));
  expect(c.connect).toHaveBeenCalledWith(expect.objectContaining({ transport: "mock", max_joint_speed: 1.5, kp: 60, kd: 1.5 }));
});
it("changes arm strength independently of motion speed and never arms on selection", () => {
  const c = connection();
  render(<RobotConnectionPanel connection={c} live={true} />);
  fireEvent.change(screen.getByLabelText("Arm strength"), { target: { value: "40" } });
  fireEvent.click(screen.getByRole("button", { name: "Connect mock robot" }));
  expect(c.connect).toHaveBeenCalledWith(expect.objectContaining({ kp: 40, kd: 1.5, max_joint_speed: 1, max_joint_acceleration: 3 }));
  expect(c.action).not.toHaveBeenCalled();
});
it("connects the selected arm with a held torso and the confirmed waist contract", () => {
  const c = connection();
  render(<RobotConnectionPanel connection={c} live={false} profile="g1-left-arm" />);
  expect(screen.getByText(/left arm follows the camera/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Movable waist axes"), { target: { value: "1" } });
  fireEvent.click(screen.getByRole("button", { name: "Connect mock robot" }));
  expect(c.connect).toHaveBeenCalledWith(expect.objectContaining({ control_mode: "single-arm", active_arm: "left", waist_dof: 1 }));
  expect(c.action).not.toHaveBeenCalled();
});
it("requires a network interface for physical DDS and never arms automatically", () => {
  const c = connection();
  render(<RobotConnectionPanel connection={c} live={true} />);
  fireEvent.change(screen.getByLabelText("Robot connection"), { target: { value: "unitree-sdk2" } });
  fireEvent.click(screen.getByRole("button", { name: "Connect physical robot" }));
  expect(c.connect).toHaveBeenCalledWith(expect.objectContaining({ transport: "unitree-sdk2", robot_model: "g1-29" }));
  expect(c.action).not.toHaveBeenCalled();
});
it("connects through the ROS bridge URL while leaving motor control disarmed", () => {
  const c = connection();
  render(<RobotConnectionPanel connection={c} live={true} />);
  fireEvent.change(screen.getByLabelText("Robot connection"), { target: { value: "unitree-rosbridge" } });
  expect(screen.queryByLabelText("Robot network interface")).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Robot ROS bridge URL"), { target: { value: "ws://192.168.67.95:9090" } });
  fireEvent.click(screen.getByRole("button", { name: "Connect physical robot" }));
  expect(c.connect).toHaveBeenCalledWith(expect.objectContaining({ transport: "unitree-rosbridge", rosbridge_url: "ws://192.168.67.95:9090" }));
  expect(c.action).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Robot ROS bridge URL"), { target: { value: "" } });
  expect(screen.getByRole("button", { name: "Connect physical robot" })).toBeDisabled();
});
it("supports Wi-Fi DDS relay discovery and validates the domain and peers", () => {
  const c = connection();
  render(<RobotConnectionPanel connection={c} live={true} />);
  fireEvent.change(screen.getByLabelText("Robot connection"), { target: { value: "unitree-sdk2" } });
  fireEvent.change(screen.getByLabelText("Robot network interface"), { target: { value: "eth1" } });
  fireEvent.change(screen.getByLabelText("Robot DDS domain"), { target: { value: "7" } });
  fireEvent.change(screen.getByLabelText("Robot DDS discovery peers"), { target: { value: "192.168.67.95" } });
  fireEvent.change(screen.getByLabelText("Robot DDS multicast"), { target: { value: "false" } });
  const button = screen.getByRole("button", { name: "Connect physical robot" });
  fireEvent.click(button);
  expect(c.connect).toHaveBeenCalledWith(expect.objectContaining({ network_interface: "eth1", domain_id: 7, discovery_peers: ["192.168.67.95"], allow_multicast: false }));
  expect(c.action).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Robot DDS discovery peers"), { target: { value: "192.168.67.999" } });
  expect(button).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Robot DDS discovery peers"), { target: { value: "" } });
  expect(button).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Robot DDS multicast"), { target: { value: "true" } });
  fireEvent.change(screen.getByLabelText("Robot DDS domain"), { target: { value: "233" } });
  expect(button).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Robot DDS domain"), { target: { value: "" } });
  expect(button).toBeDisabled();
});
it("exposes stop/disarm while the controller is armed", () => {
  const c = { ...connection(), owned: true, status: { ...connected, armed: true, reason: "Following live camera", packets_sent: 1, engagement: 1 } };
  render(<RobotConnectionPanel connection={c} live={true} />);
  fireEvent.click(screen.getByRole("button", { name: "Stop / disarm" }));
  expect(c.action).toHaveBeenCalledWith("disarm");
  expect(screen.queryByRole("button", { name: /Resume/ })).not.toBeInTheDocument();
});

it("shows received camera targets while disarmed and requires explicit arming", () => {
  const c = { ...connection(), owned: true, streamReady: true, status: connected };
  render(<RobotConnectionPanel connection={c} live={true} />);
  expect(screen.getByText(/Disarmed · motor commands are not being published/)).toBeInTheDocument();
  expect(screen.getByText(/12 camera frames received/)).toBeInTheDocument();
  const row = screen.getByText("left_elbow_joint").closest("tr")!;
  expect(within(row).getAllByRole("cell").map(cell => cell.textContent)).toEqual(["left_elbow_joint", "0.200", "0.500", "—"]);
  expect(c.action).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Arm live control" }));
  expect(c.action).toHaveBeenCalledWith("arm");
});

it("explains stream readiness and ownership blockers", () => {
  const c = { ...connection(), owned: true, status: connected };
  const view = render(<RobotConnectionPanel connection={c} live={true} />);
  expect(screen.getByRole("button", { name: "Arm live control" })).toBeDisabled();
  expect(screen.getByText(/Waiting for the camera target stream/)).toBeInTheDocument();
  view.rerender(<RobotConnectionPanel connection={{ ...c, owned: false }} live={true} />);
  expect(screen.getByText(/This browser does not own the connection/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Arm live control" })).toBeDisabled();
});
