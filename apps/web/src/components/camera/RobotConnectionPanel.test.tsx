// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { RobotConnectionPanel } from "./RobotConnectionPanel";
afterEach(cleanup);
const connection = () => ({ status: null, owned: false, busy: false, error: "", connect: vi.fn(), action: vi.fn(), submit: vi.fn() });
it("offers a mock connection and distinct hardware speed", () => {
  const c = connection();
  render(<RobotConnectionPanel connection={c} live={false} />);
  fireEvent.change(screen.getByLabelText("Robot speed"), { target: { value: "1.5" } });
  fireEvent.click(screen.getByRole("button", { name: "Connect mock robot" }));
  expect(c.connect).toHaveBeenCalledWith(expect.objectContaining({ transport: "mock", max_joint_speed: 1.5 }), "");
});
it("requires connection details for physical DDS and never arms automatically", () => {
  const c = connection();
  render(<RobotConnectionPanel connection={c} live={true} />);
  fireEvent.change(screen.getByLabelText("Robot connection"), { target: { value: "unitree-sdk2" } });
  expect(screen.getByRole("button", { name: "Connect physical robot" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Robot control key"), { target: { value: "test-key" } });
  fireEvent.click(screen.getByRole("button", { name: "Connect physical robot" }));
  expect(c.connect).toHaveBeenCalledWith(expect.objectContaining({ transport: "unitree-sdk2", robot_model: "g1-29" }), "test-key");
  expect(c.action).not.toHaveBeenCalled();
});
it("exposes stop/disarm while the controller is armed", () => {
  const c = { ...connection(), owned: true, status: { connected: true, armed: true, transport: "mock" as const, state_fresh: true, reason: "Following live camera", measured: {}, commanded: {}, packets_sent: 1, engagement: 1 } };
  render(<RobotConnectionPanel connection={c} live={true} />);
  fireEvent.click(screen.getByRole("button", { name: "Stop / disarm" }));
  expect(c.action).toHaveBeenCalledWith("disarm");
  expect(screen.queryByRole("button", { name: /Resume/ })).not.toBeInTheDocument();
});
