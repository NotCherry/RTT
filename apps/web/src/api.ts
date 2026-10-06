import type {
  CoordinationDiagnostics,
  Dataset,
  Demonstration,
  DemonstrationFrame,
  ExperimentSpec,
  Robot,
  RolloutFrame,
  RolloutResponse,
  RobotExample,
  SimulationState,
  TrainingConfig,
} from "./types";

// SAFETY: Vite's import.meta is typed as opaque; cast to access VITE_API_URL is intentional and guarded by optional chaining
const runtimeMeta = import.meta as unknown as {
  env?: { VITE_API_URL?: string };
};
const API_BASE = runtimeMeta.env?.VITE_API_URL ?? "";

export function formatApiErrorDetail(detail: unknown): string | null {
  if (typeof detail === "string" && detail.trim()) return detail;
  if (Array.isArray(detail)) {
    const messages = detail
      .map((item) => formatApiErrorDetail(item))
      .filter((item): item is string => Boolean(item));
    return messages.length ? messages.join("; ") : null;
  }
  if (!detail || typeof detail !== "object") return null;

  const record = detail as Record<string, unknown>;
  if (typeof record.detail === "string") return record.detail;
  if (typeof record.message === "string") return record.message;
  if (typeof record.msg !== "string") return null;

  const location = Array.isArray(record.loc)
    ? record.loc
        .filter((part) => part !== "body")
        .map(String)
        .join(".")
    : "";
  return location ? `${location}: ${record.msg}` : record.msg;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, init);
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const body = (await response.json()) as { detail?: unknown };
      message = formatApiErrorDetail(body.detail) ?? message;
    } catch {
      // Keep the status message when the server did not send JSON.
    }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

export function loadDemoRobot() {
  return request<Robot>("/api/robots/demo");
}

export function loadDefaultRobot() {
  return request<Robot>("/api/robots/default");
}

export function loadRobotExample(exampleId: string) {
  return request<Robot>(`/api/robots/examples/${exampleId}`);
}

export function loadRobotExamples() {
  return request<RobotExample[]>("/api/robots/examples");
}

export function uploadRobot(file: File) {
  const form = new FormData();
  form.append("file", file);
  return request<Robot>("/api/robots/parse", { method: "POST", body: form });
}

export function createSession(robotId: string) {
  return request<{ session_id: string; robot: Robot; state: SimulationState }>(
    "/api/sessions",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ robot_id: robotId }),
    },
  );
}

export function saveDemonstrations(
  sessionId: string,
  demonstrations: Demonstration[],
) {
  return request<{ status: string; demonstrations: number }>(
    `/api/sessions/${sessionId}/demonstrations`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ demonstrations }),
    },
  );
}

export function closeSession(sessionId: string) {
  return request(`/api/sessions/${sessionId}`, { method: "DELETE" });
}

export function saveDatasets(sessionId: string, datasets: Dataset[]) {
  return request<{ status: string; datasets: number }>(
    `/api/sessions/${sessionId}/datasets`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ datasets }),
    },
  );
}

export function trainSession(
  sessionId: string,
  demonstrations: Demonstration[],
  config: TrainingConfig,
) {
  return request<{ status: string }>(`/api/sessions/${sessionId}/train`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ demonstrations, config }),
  });
}

export function optimizeSession(
  sessionId: string,
  demonstrations: Demonstration[],
  config: TrainingConfig,
  experiment: ExperimentSpec,
) {
  return request<{ status: string }>(`/api/sessions/${sessionId}/optimize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      demonstrations,
      config,
      experiment,
    }),
  });
}

export function rolloutSession(
  sessionId: string,
  frames: DemonstrationFrame[],
  current: number[],
  timestepMs: number,
  maxSteps: number,
  approachMode: "scripted" | "learned" = "scripted",
  timelineFps?: number | null,
  physics: boolean = true,
) {
  return request<
    RolloutResponse & {
      frames: RolloutFrame[];
      steps: number;
      collisions: number;
      max_tracking_error: number;
      clipped_steps: number;
      physics: boolean;
      coordination?: CoordinationDiagnostics;
    }
  >(`/api/sessions/${sessionId}/rollout`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      frames,
      current,
      timestep_ms: timestepMs,
      max_steps: maxSteps,
      approach_mode: approachMode,
      timeline_fps: timelineFps ?? null,
      physics,
    }),
  });
}

export function predictPose(
  sessionId: string,
  target: number[],
  current: number[],
) {
  return request<{ target: number[]; positions: number[]; error: number }>(
    `/api/sessions/${sessionId}/predict`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target, current }),
    },
  );
}

export function exportUrl(sessionId: string) {
  return `${API_BASE}/api/sessions/${sessionId}/export`;
}

export function websocketUrl(sessionId: string) {
  if (API_BASE) {
    try {
      const url = new URL(`${API_BASE}/ws/sessions/${sessionId}`);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      return url.toString();
    } catch {
      // Fall back to the current origin when a deployment provides a malformed API URL.
    }
  }
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws/sessions/${sessionId}`;
}

export function robotTransportRequest<T>(action: string, body?: unknown, headers?: Record<string, string>) {
  return request<T>(`/api/robot-transport/${action}`, body === undefined ? undefined : {
    method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body),
  });
}

export function robotTransportSocketUrl() {
  const url = new URL(`${API_BASE}/api/robot-transport/stream`, window.location.origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}
