import { createContext, useContext, type ReactNode } from "react";
import type { Dataset, Demonstration, Robot, SimulationState } from "../types";

type WorkbenchContextValue = {
  robot: Robot | null;
  sessionId: string | null;
  state: SimulationState | null;
  positions: number[];
  demonstrations: Demonstration[];
  datasets: Dataset[];
  activeDatasetId: string | null;
  selectedDemoId: string | null;
  applyPositions: (positions: number[]) => void;
  persistDemonstrations: (demonstrations: Demonstration[]) => void;
  persistDatasets: (datasets: Dataset[]) => void;
};

const WorkbenchContext = createContext<WorkbenchContextValue | null>(null);

export function WorkbenchProvider({
  value,
  children,
}: {
  value: WorkbenchContextValue;
  children: ReactNode;
}) {
  return (
    <WorkbenchContext.Provider value={value}>
      {children}
    </WorkbenchContext.Provider>
  );
}

export function useWorkbench() {
  const context = useContext(WorkbenchContext);
  if (!context) {
    throw new Error("useWorkbench must be used inside WorkbenchProvider.");
  }
  return context;
}
