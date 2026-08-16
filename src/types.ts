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
export type Link = { name: string; visuals: Visual[] };
export type Joint = {
  name: string;
  type: string;
  parent: string;
  child: string;
  origin: Origin;
  axis: number[];
  lower: number;
  upper: number;
  controllable: boolean;
};
export type Robot = {
  id: string;
  name: string;
  filename: string;
  root: string;
  links: Link[];
  joints: Joint[];
};
export type SimulationState = { positions: number[]; training: boolean };
export type DemonstrationFrame = {
  timestamp: number;
  positions: number[];
};
export type Demonstration = {
  id: string;
  name: string;
  kind: "pose" | "gesture";
  current: number[];
  target: number[];
  frames: DemonstrationFrame[];
};
export type TrainingConfig = {
  hidden_layers: number[];
  activation: string;
  learning_rate: number;
  epochs: number;
  batch_size: number;
};
