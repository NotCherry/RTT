import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Button, Panel, PanelHeader, PanelLabel, StatusPill } from "@/components/ui";
import { H2, H3, IntroCopy, Kicker } from "@/components/ui/typography";
import { DraftNumberInput } from "@/components/ui/draft-number-input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Separator } from "@/components/ui/separator";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Dataset, Demonstration, EvolutionSearchSpace, ExperimentSpec, Joint, ModelSpec, OptimizationResult, OptimizationStatus, TrainingConfig } from "@/types";

type TrainingMetric = {
  epoch: number;
  epochs: number;
  loss: number;
  direction_alignment?: number;
  simultaneity?: number;
  multi_joint_fraction?: number;
};

type TrainingPageProps = {
  demonstrations: Demonstration[];
  datasets: Dataset[];
  activeDatasetId: string | null;
  selectedDemoId: string | null;
  controllableJoints: Joint[];
  config: TrainingConfig;
  metric: TrainingMetric | null;
  busy: boolean;
  training: boolean;
  trained: boolean;
  optimizing: boolean;
  optimizationResults: OptimizationResult[];
  optimizationStatus: OptimizationStatus;
  sessionId: string | null;
  hasUnsavedTimelineChanges?: boolean;
  onDatasetChange: (id: string) => void;
  onDemoChange: (id: string) => void;
  onConfigChange: (key: keyof TrainingConfig, value: string) => void;
  onModelSpecChange: (spec: ModelSpec) => void;
  onTrain: () => void;
  onOptimize: (experiment: ExperimentSpec) => void;
};

const fallbackSpec: ModelSpec = {
  version: 1,
  family: "mlp",
  name: "Fast MLP",
  blocks: [
    { type: "dense", width: 64, activation: "relu" },
    { type: "dense", width: 64, activation: "relu" },
  ],
};

function estimateParameters(inputSize: number, outputSize: number, spec: ModelSpec) {
  let previous = inputSize;
  let total = 0;
  spec.blocks.forEach((block) => {
    total += previous * block.width + block.width;
    previous = block.width;
  });
  return total + previous * outputSize + outputSize;
}

export function TrainingPage({
  demonstrations, datasets, activeDatasetId, selectedDemoId, controllableJoints,
  config, metric, busy, training, trained, optimizing, optimizationResults, optimizationStatus,
  sessionId, hasUnsavedTimelineChanges, onDatasetChange, onDemoChange,
  onConfigChange, onModelSpecChange, onTrain, onOptimize,
}: TrainingPageProps) {
  const [searchTrials, setSearchTrials] = useState(6);
  const [trialEpochs, setTrialEpochs] = useState(30);
  const [searchStrategy, setSearchStrategy] = useState<"quick" | "evolution">("quick");
  const [populationSize, setPopulationSize] = useState(4);
  const [generations, setGenerations] = useState(3);
  const [searchSpace, setSearchSpace] = useState<EvolutionSearchSpace>({
    optimize_width: true, min_width: 16, max_width: 256, width_step: 16,
    optimize_depth: true, min_depth: 1, max_depth: 4,
    activations: ["relu", "tanh", "gelu"],
    optimize_learning_rate: true, min_learning_rate: 0.0003, max_learning_rate: 0.01,
  });
  const spec = config.model_spec ?? fallbackSpec;
  const selected = demonstrations.find((item) => item.id === selectedDemoId);
  const visibleDemonstrations = demonstrations.filter(
    (item) => !activeDatasetId || item.dataset_id === activeDatasetId,
  );
  const inputSize = controllableJoints.length * 3 + 1;
  const parameterCount = useMemo(
    () => estimateParameters(inputSize, controllableJoints.length, spec),
    [controllableJoints.length, inputSize, spec],
  );
  const bestOptimizationResult = useMemo(
    () => [...optimizationResults].sort((left, right) => left.score - right.score)[0],
    [optimizationResults],
  );
  const searchSpaceRangesValid = (
    searchSpace.min_width <= searchSpace.max_width &&
    searchSpace.min_depth <= searchSpace.max_depth &&
    searchSpace.min_learning_rate <= searchSpace.max_learning_rate
  );
  const searchSpaceHasVariation = (
    (searchSpace.optimize_width && searchSpace.min_width < searchSpace.max_width) ||
    (searchSpace.optimize_depth && searchSpace.min_depth < searchSpace.max_depth) ||
    searchSpace.activations.length > 1 ||
    (searchSpace.optimize_learning_rate && searchSpace.min_learning_rate < searchSpace.max_learning_rate)
  );
  const searchSpaceValid = searchStrategy === "quick" || (
    searchSpaceRangesValid && searchSpaceHasVariation
  );
  const canTrain = Boolean(sessionId && selected && !busy && !training && !optimizing);
  const canSearch = canTrain && searchSpaceValid;
  const experiment: ExperimentSpec = searchStrategy === "quick"
    ? {
        version: 1, strategy: "quick", trials: searchTrials,
        trial_epochs: trialEpochs, score_name: "checkpoint_fidelity", score_version: 1,
      }
    : {
        version: 1, strategy: "evolution", population_size: populationSize,
        generations, mutation_rate: 0.35, search_space: searchSpace,
        trial_epochs: trialEpochs,
        score_name: "checkpoint_fidelity", score_version: 1,
      };
  const candidateFits = searchStrategy === "quick" ? searchTrials : populationSize * generations;
  function toggleActivation(activation: EvolutionSearchSpace["activations"][number]) {
    setSearchSpace((current) => {
      const selected = current.activations.includes(activation);
      if (selected && current.activations.length === 1) return current;
      return {
        ...current,
        activations: selected
          ? current.activations.filter((item) => item !== activation)
          : [...current.activations, activation],
      };
    });
  }
  const optimizationMetricLabel = optimizationStatus === "running"
    ? "Current best loss"
    : optimizationStatus === "promoted"
      ? "Promoted loss"
      : optimizationStatus === "historical"
        ? "Previous experiment best"
        : optimizationStatus === "failed"
          ? "Unpromoted best"
          : "Best loss";

  function updateBlock(index: number, update: Partial<ModelSpec["blocks"][number]>) {
    onModelSpecChange({
      ...spec,
      blocks: spec.blocks.map((block, blockIndex) =>
        blockIndex === index ? { ...block, ...update } : block,
      ),
    });
  }

  function removeBlock(index: number) {
    if (spec.blocks.length <= 1) return;
    onModelSpecChange({ ...spec, blocks: spec.blocks.filter((_, blockIndex) => blockIndex !== index) });
  }

  function addBlock() {
    if (spec.blocks.length >= 8) return;
    onModelSpecChange({
      ...spec,
      blocks: [...spec.blocks, { type: "dense", width: 64, activation: "relu" }],
    });
  }

  return (
    <div className="route-page">
      <div className="route-heading">
        <div>
          <Kicker>TRAIN / MODEL LAB</Kicker>
          <H2>Build, compare, then train.</H2>
          <IntroCopy>
            Compose a behavior model with readable blocks and search a bounded set of alternatives before evaluation.
          </IntroCopy>
        </div>
        <StatusPill online={Boolean(training || optimizing)}>
          {optimizing ? "Searching" : training ? "Training" : trained ? "Model ready" : "Idle"}
        </StatusPill>
      </div>

      <Panel className="route-content-panel">
        <PanelHeader>
          <div>
            <PanelLabel>MODEL LAB</PanelLabel>
            <H3>{selected ? selected.name : "Choose a training target"}</H3>
          </div>
          <span className="count-badge">{spec.blocks.length} blocks · {parameterCount.toLocaleString()} params</span>
        </PanelHeader>

        <Tabs defaultValue="data" className="p-4">
          <TabsList className="grid-cols-4" aria-label="Model Lab steps">
            <TabsTrigger value="data">1 Data</TabsTrigger>
            <TabsTrigger value="network">2 Network</TabsTrigger>
            <TabsTrigger value="optimize">3 Optimize</TabsTrigger>
            <TabsTrigger value="results">4 Results</TabsTrigger>
          </TabsList>

          <TabsContent value="data" className="space-y-4 pt-3">
            <div className="route-selection-grid">
              <Label className="flex flex-col gap-2">
                Dataset
                <NativeSelect value={activeDatasetId ?? ""} onChange={(event) => onDatasetChange(event.target.value)}>
                  <option value="">All datasets</option>
                  {datasets.map((dataset) => <option value={dataset.id} key={dataset.id}>{dataset.name}</option>)}
                </NativeSelect>
              </Label>
              <div className="rounded border border-line-650 bg-ink-850 p-3">
                <PanelLabel>SEARCH VALIDATION</PanelLabel>
                <p className="mt-2 text-xs leading-5 text-text-500">
                  Quick search compares candidates on authored checkpoints. A separate holdout split arrives with multi-demonstration search.
                </p>
              </div>
            </div>
            <Separator />
            <div className="space-y-2">
              <PanelLabel>Training target — one archived item</PanelLabel>
              {visibleDemonstrations.length ? (
                <div className="grid gap-2" role="radiogroup" aria-label="Training target">
                  {visibleDemonstrations.map((demonstration) => (
                    <label key={demonstration.id} className="flex cursor-pointer items-center gap-3 rounded border border-line-600 bg-ink-850 p-3 text-xs text-text-100 hover:border-accent-500">
                      <input type="radio" name="training-target" checked={selectedDemoId === demonstration.id} onChange={() => onDemoChange(demonstration.id)} aria-label={`Train ${demonstration.name}`} />
                      <span className="font-mono">
                        {demonstration.name}
                        <span className="ml-2 text-text-500">{demonstration.kind} · {demonstration.keyframes?.length ?? demonstration.frames.length} checkpoints</span>
                      </span>
                    </label>
                  ))}
                </div>
              ) : <p className="helper-text px-0">No demonstrations are available in this dataset.</p>}
            </div>
          </TabsContent>

          <TabsContent value="network" className="space-y-4 pt-3">
            <div className="grid gap-3 lg:grid-cols-[220px_minmax(0,1fr)]">
              <div className="space-y-2 rounded border border-line-650 bg-ink-900 p-3">
                <PanelLabel>BLOCK PALETTE</PanelLabel>
                <Button variant="secondary" full onClick={addBlock} disabled={spec.blocks.length >= 8}>+ Dense block</Button>
                <p className="text-[10px] leading-4 text-text-600">
                  Temporal Conv, ACT and Diffusion blocks will plug into this compiler interface in later milestones.
                </p>
              </div>
              <div className="space-y-2" aria-label="Model block stack">
                <div className="rounded border border-accent-500/40 bg-accent-deep p-3 font-mono text-xs text-text-100">
                  <strong>Robot state history</strong><span className="float-right text-text-500">{inputSize} values · locked</span>
                </div>
                {spec.blocks.map((block, index) => (
                  <div key={`${index}-${block.type}`} className="grid gap-3 rounded border border-line-600 bg-ink-850 p-3 md:grid-cols-[auto_1fr_1fr_auto] md:items-end">
                    <span className="grid h-8 w-8 place-items-center rounded bg-accent-deep font-mono text-xs text-accent-300">{index + 1}</span>
                    <Label>
                      Dense width
                      <DraftNumberInput integer min="1" max="512" value={block.width} onValueChange={(value) => updateBlock(index, { width: value })} />
                    </Label>
                    <Label>
                      Activation
                      <NativeSelect value={block.activation} onChange={(event) => updateBlock(index, { activation: event.target.value as typeof block.activation })}>
                        <option value="relu">ReLU</option><option value="tanh">Tanh</option><option value="gelu">GELU</option>
                      </NativeSelect>
                    </Label>
                    <Button variant="ghost" size="small" onClick={() => removeBlock(index)} disabled={spec.blocks.length <= 1}>Remove</Button>
                  </div>
                ))}
                <div className="rounded border border-success-400/30 bg-ink-850 p-3 font-mono text-xs text-text-100">
                  <strong>Joint action</strong><span className="float-right text-text-500">{controllableJoints.length} values · locked</span>
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="optimize" className="space-y-4 pt-3">
            <div className="route-form-grid">
              <Label>Learning rate<DraftNumberInput min="0.000001" max="1" step="any" value={config.learning_rate} onValueChange={(value) => onConfigChange("learning_rate", String(value))} /></Label>
              <Label>Final training epochs<DraftNumberInput integer min="1" max="5000" value={config.epochs} onValueChange={(value) => onConfigChange("epochs", String(value))} /></Label>
              <Label>Increment (ms)<DraftNumberInput integer min="10" max="2000" value={config.timestep_ms} onValueChange={(value) => onConfigChange("timestep_ms", String(value))} /></Label>
              <Label>Random starts<DraftNumberInput integer min="0" max="64" value={config.random_starts} onValueChange={(value) => onConfigChange("random_starts", String(value))} /></Label>
            </div>
            <div className="rounded border border-line-650 bg-ink-850 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <PanelLabel>MODEL SEARCH</PanelLabel>
                  <p className="mt-2 max-w-2xl text-xs leading-5 text-text-500">{searchStrategy === "quick" ? "Compare a fixed set of nearby widths, activations and learning rates." : "Keep the strongest candidates, then mutate layer widths, depth, activations and learning rate for the next generation."} Trials run one at a time and only the current and best model are retained in memory.</p>
                </div>
                <StatusPill online={optimizing}>{optimizing ? "Running" : "1 worker"}</StatusPill>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <Label>Search method<NativeSelect value={searchStrategy} onChange={(event) => setSearchStrategy(event.target.value as typeof searchStrategy)}><option value="quick">Quick scan</option><option value="evolution">Evolution</option></NativeSelect></Label>
                <Label>Epochs per candidate<DraftNumberInput integer min="5" max="300" value={trialEpochs} onValueChange={setTrialEpochs} /></Label>
                {searchStrategy === "quick" ? (
                  <Label>Candidates<DraftNumberInput integer min="2" max="12" value={searchTrials} onValueChange={setSearchTrials} /></Label>
                ) : (
                  <>
                    <Label>Population<DraftNumberInput integer min="2" max="8" value={populationSize} onValueChange={setPopulationSize} /></Label>
                    <Label>Generations<DraftNumberInput integer min="2" max="6" value={generations} onValueChange={setGenerations} /></Label>
                  </>
                )}
              </div>
              {searchStrategy === "evolution" && (
                <details className="mt-4 rounded border border-line-650 bg-ink-900 p-3">
                  <summary className="cursor-pointer font-mono text-xs text-text-300">Parameters to evolve</summary>
                  <div className="mt-4 space-y-4">
                    <div className="grid gap-3 sm:grid-cols-3">
                      <Label className="flex flex-row items-center gap-2"><input type="checkbox" checked={searchSpace.optimize_width} onChange={(event) => setSearchSpace((current) => ({ ...current, optimize_width: event.target.checked }))} />Dense width</Label>
                      <Label>Minimum width<DraftNumberInput integer min="1" max="512" value={searchSpace.min_width} onValueChange={(value) => setSearchSpace((current) => ({ ...current, min_width: value }))} /></Label>
                      <Label>Maximum width<DraftNumberInput integer min="1" max="512" value={searchSpace.max_width} onValueChange={(value) => setSearchSpace((current) => ({ ...current, max_width: value }))} /></Label>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <Label className="flex flex-row items-center gap-2"><input type="checkbox" checked={searchSpace.optimize_depth} onChange={(event) => setSearchSpace((current) => ({ ...current, optimize_depth: event.target.checked }))} />Network depth</Label>
                      <Label>Minimum blocks<DraftNumberInput integer min="1" max="8" value={searchSpace.min_depth} onValueChange={(value) => setSearchSpace((current) => ({ ...current, min_depth: value }))} /></Label>
                      <Label>Maximum blocks<DraftNumberInput integer min="1" max="8" value={searchSpace.max_depth} onValueChange={(value) => setSearchSpace((current) => ({ ...current, max_depth: value }))} /></Label>
                    </div>
                    <div>
                      <PanelLabel>ACTIVATIONS</PanelLabel>
                      <div className="mt-2 flex flex-wrap gap-3">{(["relu", "tanh", "gelu"] as const).map((activation) => <Label key={activation} className="flex flex-row items-center gap-2"><input type="checkbox" checked={searchSpace.activations.includes(activation)} onChange={() => toggleActivation(activation)} />{activation.toUpperCase()}</Label>)}</div>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <Label className="flex flex-row items-center gap-2"><input type="checkbox" checked={searchSpace.optimize_learning_rate} onChange={(event) => setSearchSpace((current) => ({ ...current, optimize_learning_rate: event.target.checked }))} />Learning rate</Label>
                      <Label>Minimum rate<DraftNumberInput min="0.000001" max="1" step="any" value={searchSpace.min_learning_rate} onValueChange={(value) => setSearchSpace((current) => ({ ...current, min_learning_rate: value }))} /></Label>
                      <Label>Maximum rate<DraftNumberInput min="0.000001" max="1" step="any" value={searchSpace.max_learning_rate} onValueChange={(value) => setSearchSpace((current) => ({ ...current, max_learning_rate: value }))} /></Label>
                    </div>
                  </div>
                </details>
              )}
              {!searchSpaceRangesValid && <div className="mt-3 alert warning" role="alert">Each minimum must be less than or equal to its maximum.</div>}
              {searchStrategy === "evolution" && searchSpaceRangesValid && !searchSpaceHasVariation && <div className="mt-3 alert warning" role="alert">Enable at least one parameter with a range or multiple activation choices.</div>}
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                <Button variant="primary" onClick={() => onOptimize(experiment)} disabled={!canSearch}>{optimizing ? "Searching…" : searchStrategy === "quick" ? `Scan ${candidateFits} candidates` : `Evolve ${generations} generations · ${candidateFits} fits`}</Button>
                <Button variant="secondary" onClick={onTrain} disabled={!canTrain}>{selected ? `Train “${selected.name}”` : "Select a training target"}</Button>
              </div>
            </div>
            <Label className="flex flex-row items-center gap-2">
              <input type="checkbox" checked={config.physics} onChange={(event) => onConfigChange("physics", String(event.target.checked))} className="h-4 w-4 rounded border-line-600 bg-ink-800" />
              Physics-realistic samples
            </Label>
          </TabsContent>

          <TabsContent value="results" className="space-y-4 pt-3">
            <div className="route-metric-grid">
              <Metric label={bestOptimizationResult ? optimizationMetricLabel : "Latest loss"} value={bestOptimizationResult ? bestOptimizationResult.loss.toFixed(5) : metric ? metric.loss.toFixed(5) : "—"} />
              <Metric label="Progress" value={metric ? `${metric.epoch}/${metric.epochs}` : "—"} />
              <Metric label="Parameters" value={parameterCount.toLocaleString()} />
              <Metric label="Simultaneity" value={bestOptimizationResult ? bestOptimizationResult.simultaneity.toFixed(2) : metric?.simultaneity?.toFixed(2) ?? "—"} />
            </div>
            {optimizationResults.length ? (
              <div className="overflow-x-auto rounded border border-line-650">
                <table className="w-full border-collapse text-left font-mono text-xs">
                  <thead className="bg-ink-900 text-text-500"><tr><th className="p-3">Generation</th><th className="p-3">Candidate</th><th className="p-3">Score ↓</th><th className="p-3">Loss</th><th className="p-3">Shape</th><th className="p-3">Activation</th></tr></thead>
                  <tbody>{[...optimizationResults].sort((left, right) => left.score - right.score).map((result, index) => (
                    <tr key={result.trial} className="border-t border-line-650 text-text-300"><td className="p-3">{result.generation}</td><td className="p-3">{index === 0 ? "★ " : ""}#{result.candidate}</td><td className="p-3">{result.score.toFixed(5)}</td><td className="p-3">{result.loss.toFixed(5)}</td><td className="p-3">{(result.config.model_spec?.blocks.map((block) => block.width) ?? result.config.hidden_layers).join(" → ")}</td><td className="p-3">{result.config.model_spec?.blocks.map((block) => block.activation).join(" / ") ?? result.config.activation}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            ) : <div className="rounded border border-dashed border-line-650 p-6 text-center text-xs text-text-600">Run Quick search to compare candidates. The lowest score is promoted automatically and can be inspected in Evaluate.</div>}
            <Button variant="secondary" size="small" asChild><Link to="/evaluate">Open evaluation</Link></Button>
          </TabsContent>
        </Tabs>

        {hasUnsavedTimelineChanges && <div className="alert warning" role="alert">Timeline has unsaved changes — training uses the last saved gesture.</div>}
      </Panel>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <Card className="gap-0 rounded-none border-0 bg-ink-850 py-4"><CardContent className="p-4"><PanelLabel>{label}</PanelLabel><strong className="mt-2 block font-mono text-lg text-text-100">{value}</strong></CardContent></Card>;
}
