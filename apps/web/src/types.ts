export type Origin = { xyz: number[]; rpy: number[] };

export type VisualGeometry =
  | { type: "box"; size: number[] }
  | { type: "cylinder"; radius: number; length: number }
  | { type: "sphere"; radius: number };

export type Visual = {
  geometry: VisualGeometry;
  origin: Origin;
  color: number[];
};
export type Link = {
  name: string;
  visuals: Visual[];
  collisions?: Visual[];
  inertial?: {
    mass: number;
    inertia: {
      ixx: number;
      iyy: number;
      izz: number;
      ixy: number;
      ixz: number;
      iyz: number;
    };
    origin: Origin;
    synthesized: boolean;
  };
};
export type Joint = {
  name: string;
  type: string;
  parent: string;
  child: string;
  origin: Origin;
  axis: number[];
  lower: number;
  upper: number;
  velocity?: number;
  effort?: number;
  damping?: number;
  friction?: number;
  controllable: boolean;
};
export type Robot = {
  id: string;
  name: string;
  filename: string;
  root: string;
  links: Link[];
  joints: Joint[];
  gravity?: number[];
  use_fixed_base?: boolean;
  physics_timestep?: number;
};
export type SimulationState = { positions: number[]; training: boolean };
export type DemonstrationFrame = {
  timestamp: number;
  positions: number[];
  interpolation?: KeyframeInterpolation;
};
export type KeyframeInterpolation = "linear" | "step";
export type Keyframe = {
  id: string;
  frame: number;
  timestamp: number;
  positions: number[];
  interpolation: KeyframeInterpolation;
};
export type Demonstration = {
  id: string;
  name: string;
  kind: "pose" | "gesture";
  current: number[];
  target: number[];
  frames: DemonstrationFrame[];
  keyframes?: Keyframe[];
  timeline_fps?: number;
  duration_frames?: number;
  start_frame_index?: number;
  dataset_id?: string;
};
export type Dataset = {
  id: string;
  name: string;
  demonstration_ids: string[];
  created_at: string;
  updated_at: string;
};
export type TrainingConfig = {
  hidden_layers: number[];
  activation: string;
  learning_rate: number;
  epochs: number;
  batch_size: number;
  timestep_ms: number;
  random_starts: number;
  random_seed: number;
  rollout_steps: number;
  physics?: boolean;
  coordination_weight?: number;
};
export type CoordinationDiagnostics = {
  simultaneity: number;
  direction_alignment: number;
  multi_joint_steps: number;
  sequential: boolean;
};
export type RolloutFrame = {
  timestamp: number;
  positions: number[];
  expected: number[];
  phase?: "approach" | "gesture";
  source?: "model-rollout" | "derived-preview" | "model-prediction";
  tracking_error?: number;
  clipped?: number;
};
export type RolloutResponse = {
  frames: RolloutFrame[];
  steps: number;
  collisions: number;
  max_tracking_error: number;
  clipped_steps: number;
  physics: boolean;
  segment_diagnostics?: {
    segment_index: number;
    segment_ms: number;
    raw_steps: number;
    scaled_steps: number;
    scale: number;
    effective_scale?: number;
    density_ratio: number;
    grid_ms: number;
  }[];
  density_ratio?: number;
  warnings?: { type: string; message: string }[];
  coordination?: CoordinationDiagnostics;
};
