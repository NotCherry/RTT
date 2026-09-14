import { afterEach, describe, expect, it, vi } from "vitest";
import { formatApiErrorDetail, trainSession } from "./api";

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
});
