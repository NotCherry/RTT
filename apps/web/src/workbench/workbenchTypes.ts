import type { ModelSpec, TrainingConfig } from "@/types";

/** Default configuration for a newly opened robot workbench. */
export const initialTrainingConfig: TrainingConfig = {
  hidden_layers: [64, 64],
  activation: "relu",
  learning_rate: 0.003,
  epochs: 300,
  batch_size: 16,
  timestep_ms: 120,
  random_starts: 4,
  random_seed: 7,
  rollout_steps: 160,
  physics: true,
  model_spec: {
    version: 1,
    family: "mlp",
    name: "Fast MLP",
    blocks: [
      { type: "dense", width: 64, activation: "relu" },
      { type: "dense", width: 64, activation: "relu" },
    ],
  },
};

export type TrainingMetric = {
  epoch: number;
  epochs: number;
  loss: number;
  direction_alignment?: number;
  simultaneity?: number;
  multi_joint_fraction?: number;
};

export type EvaluationResult = {
  target: number[];
  positions: number[];
  error: number;
};

export type RolloutDiagnostics = {
  density_ratio?: number;
  warnings?: { type: string; message: string }[];
  segment_diagnostics?: {
    segment_index: number;
    raw_steps: number;
    scaled_steps: number;
    density_ratio: number;
  }[];
  coordination?: {
    simultaneity: number;
    direction_alignment: number;
    multi_joint_steps: number;
    sequential: boolean;
  } | null;
};
