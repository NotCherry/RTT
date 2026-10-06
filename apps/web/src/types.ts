export type Origin = { xyz: number[]; rpy: number[] };

export type VisualGeometry =
  | { type: "box"; size: number[] }
  | { type: "cylinder"; radius: number; length: number }
  | { type: "sphere"; radius: number }
  | { type: "mesh"; url: string };

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
  display_ground_offset?: number;
};
export type RobotExample = {
  id: string;
  name: string;
  description: string;
  filename: string;
  dof: number;
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
  source?: "camera";
  camera_capture_id?: string;
  retargeting_profile?: string;
  retargeting_profile_version?: 1 | 2;
};

export type LandmarkPoint = {
  x: number;
  y: number;
  z: number;
  visibility?: number;
};

export type LandmarkFrame = {
  timestamp: number;
  pose: LandmarkPoint[];
  pose_world?: LandmarkPoint[];
  source_aspect_ratio?: number;
  left_hand: LandmarkPoint[];
  right_hand: LandmarkPoint[];
  confidence: number;
};

/** A device-local stick-figure source for a camera-derived demonstration. */
export type CameraCapture = {
  id: string;
  version: 1;
  name: string;
  created_at: string;
  mode: "simple" | "continuous";
  sample_rate: 10 | 15 | 30;
  source:
    | { kind: "local-media-stream"; stream_count: 1 }
    | { kind: "ip-image-stream"; url: string };
  frames: LandmarkFrame[];
  quality: { accepted_frames: number; rejected_frames: number };
  retargeting_profile: "g1-upper-body" | "g1-single-arm" | "g1-left-arm" | "g1-full-body";
  retargeting_profile_version: 1 | 2;
  video_id?: string;
  demonstration_id?: string;
};
export type Dataset = {
  id: string;
  name: string;
  demonstration_ids: string[];
  created_at: string;
  updated_at: string;
};
export type DenseModelBlock = {
  type: "dense";
  width: number;
  activation: "relu" | "tanh" | "gelu";
};
export type ModelSpec = {
  version: 1;
  family: "mlp";
  name: string;
  blocks: DenseModelBlock[];
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
  model_spec?: ModelSpec;
};
export type OptimizationResult = {
  trial: number;
  generation: number;
  candidate: number;
  score: number;
  score_name: "checkpoint_fidelity";
  score_version: 1;
  score_basis: "checkpoint_mae" | "training_loss";
  reproduction_error: number;
  simultaneity_penalty: number;
  loss: number;
  simultaneity: number;
  config: TrainingConfig;
};
export type OptimizationStatus = "idle" | "running" | "promoted" | "historical" | "failed";
type ExperimentSpecBase = {
  version: 1;
  trial_epochs: number;
  score_name: "checkpoint_fidelity";
  score_version: 1;
};
export type QuickExperimentSpec = ExperimentSpecBase & {
  strategy: "quick";
  trials: number;
};
export type EvolutionSearchSpace = {
  optimize_width: boolean;
  min_width: number;
  max_width: number;
  width_step: number;
  optimize_depth: boolean;
  min_depth: number;
  max_depth: number;
  activations: Array<"relu" | "tanh" | "gelu">;
  optimize_learning_rate: boolean;
  min_learning_rate: number;
  max_learning_rate: number;
};
export type EvolutionExperimentSpec = ExperimentSpecBase & {
  strategy: "evolution";
  population_size: number;
  generations: number;
  mutation_rate: number;
  search_space: EvolutionSearchSpace;
};
export type ExperimentSpec = QuickExperimentSpec | EvolutionExperimentSpec;
export type ExperimentRecord = {
  id: string;
  version: 1;
  demonstration_id: string;
  demonstration_name: string;
  created_at: string;
  experiment: ExperimentSpec;
  best_trial: number;
  results: OptimizationResult[];
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
