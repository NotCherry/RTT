import { Link } from "react-router-dom";
import {
  Button,
  Panel,
  PanelHeader,
  PanelLabel,
  StatusPill,
} from "@/components/ui";
import { H2, H3, IntroCopy, Kicker } from "@/components/ui/typography";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Separator } from "@/components/ui/separator";
import { Card, CardContent } from "@/components/ui/card";
import type { Dataset, Demonstration, Joint, TrainingConfig } from "@/types";

type TrainingMetric = { epoch: number; epochs: number; loss: number };

type TrainingPageProps = {
  demonstrations: Demonstration[];
  datasets: Dataset[];
  activeDatasetId: string | null;
  selectedDemoId: string | null;
  controllableJoints: Joint[];
  config: TrainingConfig;
  hiddenLayerText: string;
  metric: TrainingMetric | null;
  busy: boolean;
  training: boolean;
  trained: boolean;
  sessionId: string | null;
  onDatasetChange: (id: string) => void;
  onDemoChange: (id: string) => void;
  onConfigChange: (key: keyof TrainingConfig, value: string) => void;
  onTrain: () => void;
};

export function TrainingPage({
  demonstrations,
  datasets,
  activeDatasetId,
  selectedDemoId,
  controllableJoints,
  config,
  hiddenLayerText,
  metric,
  busy,
  training,
  trained,
  sessionId,
  onDatasetChange,
  onDemoChange,
  onConfigChange,
  onTrain,
}: TrainingPageProps) {
  return (
    <div className="route-page">
      <div className="route-heading">
        <div>
          <Kicker>TRAIN / TEMPORAL MLP</Kicker>
          <H2>Train from keyframe motion.</H2>
          <IntroCopy>
            The model learns small joint deltas between authored keyframes,
            including seeded randomized starts.
          </IntroCopy>
        </div>
        <StatusPill online={Boolean(training)}>
          {training ? "Training" : trained ? "Model ready" : "Idle"}
        </StatusPill>
      </div>
      <Panel className="route-content-panel">
        <PanelHeader>
          <div>
            <PanelLabel>TRAINING RUN</PanelLabel>
            <H3>Behavior cloning configuration</H3>
          </div>
          <span className="count-badge">{demonstrations.length} demos</span>
        </PanelHeader>
        <div className="route-selection-grid">
          <Label className="flex flex-col gap-2">
            Dataset
            <NativeSelect
              value={activeDatasetId ?? ""}
              onChange={(e) => onDatasetChange(e.target.value)}
            >
              <option value="">All datasets</option>
              {datasets.map((d) => (
                <option value={d.id} key={d.id}>
                  {d.name}
                </option>
              ))}
            </NativeSelect>
          </Label>
        </div>
        <Separator />
        <div className="flex flex-col gap-2">
          <PanelLabel>Training target — one archived item</PanelLabel>
          {demonstrations.length ? (
            <div
              className="flex flex-col gap-1"
              role="radiogroup"
              aria-label="Training target"
            >
              {demonstrations
                .filter(
                  (d) => !activeDatasetId || d.dataset_id === activeDatasetId,
                )
                .map((d) => (
                  <label
                    key={d.id}
                    className="flex cursor-pointer items-center gap-2 rounded border border-line-600 bg-ink-800 p-2 text-[11px] text-text-100"
                  >
                    <input
                      type="radio"
                      name="training-target"
                      checked={selectedDemoId === d.id}
                      onChange={() => onDemoChange(d.id)}
                      aria-label={`Train ${d.name}`}
                    />
                    <span className="font-mono">
                      {d.name}
                      <span className="text-text-500">
                        {" "}
                        · {d.kind} · {d.keyframes?.length ?? d.frames.length}{" "}
                        authored keyframes
                      </span>
                    </span>
                  </label>
                ))}
            </div>
          ) : (
            <p className="helper-text">
              No archived demonstrations yet. Capture a pose or author a gesture
              first.
            </p>
          )}
        </div>
        <Separator />
        <div className="route-form-grid">
          <Label>
            Hidden layers
            <Input
              value={hiddenLayerText}
              onChange={(e) => onConfigChange("hidden_layers", e.target.value)}
            />
          </Label>
          <Label>
            Activation
            <NativeSelect
              value={config.activation}
              onChange={(e) => onConfigChange("activation", e.target.value)}
            >
              <option value="relu">ReLU</option>
              <option value="tanh">Tanh</option>
              <option value="gelu">GELU</option>
            </NativeSelect>
          </Label>
          <Label>
            Increment (ms)
            <Input
              type="number"
              min="10"
              max="2000"
              value={config.timestep_ms}
              onChange={(e) => onConfigChange("timestep_ms", e.target.value)}
            />
          </Label>
          <Label>
            Random starts
            <Input
              type="number"
              min="0"
              max="64"
              value={config.random_starts}
              onChange={(e) => onConfigChange("random_starts", e.target.value)}
            />
          </Label>
          <Label>
            Rollout steps
            <Input
              type="number"
              min="1"
              max="2000"
              value={config.rollout_steps}
              onChange={(e) => onConfigChange("rollout_steps", e.target.value)}
            />
          </Label>
          <p className="helper-text">
            Gesture rollout density follows the demonstration timeline fps
            (capped by rollout steps); Increment (ms) applies to the scripted
            approach and the timestep fallback.
          </p>
          <Label>
            Epochs
            <Input
              type="number"
              min="1"
              max="5000"
              value={config.epochs}
              onChange={(e) => onConfigChange("epochs", e.target.value)}
            />
          </Label>
        </div>
        <div className="route-actions">
          <Button
            variant="primary"
            onClick={onTrain}
            disabled={
              !sessionId ||
              !demonstrations.find((d) => d.id === selectedDemoId) ||
              busy ||
              training
            }
          >
            {selectedDemoId
              ? `Train “${demonstrations.find((d) => d.id === selectedDemoId)?.name ?? "selected"}”`
              : "Select a training target"}
          </Button>
          <Button variant="secondary" size="small" asChild>
            <Link to="/evaluate">Open evaluation</Link>
          </Button>
        </div>
        <div className="route-metric-grid">
          <Card className="rounded-none border-0 py-4 gap-0 bg-ink-850">
            <CardContent className="p-4">
              <PanelLabel>LATEST LOSS</PanelLabel>
              <strong className="mt-2 block font-mono text-lg text-text-100">
                {metric ? metric.loss.toFixed(5) : "—"}
              </strong>
            </CardContent>
          </Card>
          <Card className="rounded-none border-0 py-4 gap-0 bg-ink-850">
            <CardContent className="p-4">
              <PanelLabel>PROGRESS</PanelLabel>
              <strong className="mt-2 block font-mono text-lg text-text-100">
                {metric ? `${metric.epoch}/${metric.epochs}` : "—"}
              </strong>
            </CardContent>
          </Card>
          <Card className="rounded-none border-0 py-4 gap-0 bg-ink-850">
            <CardContent className="p-4">
              <PanelLabel>INPUTS</PanelLabel>
              <strong className="mt-2 block font-mono text-lg text-text-100">
                {controllableJoints.length * 2 + 1}
              </strong>
            </CardContent>
          </Card>
          <Card className="rounded-none border-0 py-4 gap-0 bg-ink-850">
            <CardContent className="p-4">
              <PanelLabel>OUTPUTS</PanelLabel>
              <strong className="mt-2 block font-mono text-lg text-text-100">
                {controllableJoints.length}
              </strong>
            </CardContent>
          </Card>
        </div>
      </Panel>
    </div>
  );
}
