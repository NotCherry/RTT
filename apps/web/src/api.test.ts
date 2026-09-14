import { afterEach, describe, expect, it, vi } from "vitest";
import { formatApiErrorDetail, optimizeSession, trainSession } from "./api";
import type { Demonstration } from "./types";

afterEach(() => vi.restoreAllMocks());

describe("API error formatting", () => {
  it("turns FastAPI validation details into a readable field error", () => {
    expect(
      formatApiErrorDetail([
        {
          type: "less_than_equal",
          loc: ["body", "config", "epochs"],
          msg: "Input should be less than or equal to 5000",
          input: 20000,
        },
      ]),
    ).toBe("config.epochs: Input should be less than or equal to 5000");
  });

  it("preserves ordinary string details", () => {
    expect(formatApiErrorDetail("Train a model first.")).toBe(
      "Train a model first.",
    );
  });

  it("sends an 800 epoch budget unchanged in the training request", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "training" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await trainSession(
      "session-1",
      [
        {
          id: "pose-1",
          name: "Pose",
          kind: "pose",
          current: [0],
          target: [0.5],
          frames: [{ timestamp: 0, positions: [0.5] }],
        },
      ],
      {
        hidden_layers: [64, 64],
        activation: "relu",
        learning_rate: 0.003,
        epochs: 800,
        batch_size: 16,
        timestep_ms: 120,
        random_starts: 4,
        random_seed: 7,
        rollout_steps: 160,
        physics: true,
      },
    );

    const request = fetchMock.mock.calls[0]?.[1];
    expect(JSON.parse(String(request?.body)).config.epochs).toBe(800);
  });

  it("sends a versioned quick-search experiment contract", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "started" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const config = {
      hidden_layers: [64], activation: "relu", learning_rate: 0.003,
      epochs: 300, batch_size: 16, timestep_ms: 120, random_starts: 0,
      random_seed: 7, rollout_steps: 160,
    };
    const demonstration: Demonstration = {
      id: "pose-1", name: "Pose", kind: "pose", current: [0], target: [0.5],
      frames: [{ timestamp: 0, positions: [0.5] }],
    };

    await optimizeSession("session-1", [demonstration], config, 6, 30);

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.experiment).toEqual({
      version: 1,
      strategy: "quick",
      trials: 6,
      trial_epochs: 30,
      score_name: "checkpoint_fidelity",
      score_version: 1,
    });
  });
});
