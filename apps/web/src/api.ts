import type {
  Dataset,
  Demonstration,
  DemonstrationFrame,
  Robot,
  RolloutFrame,
  SimulationState,
  TrainingConfig,
} from "./types";

// SAFETY: Vite's import.meta is typed as opaque; cast to access VITE_API_URL is intentional and guarded by optional chaining
const runtimeMeta = import.meta as unknown as {
  env?: { VITE_API_URL?: string };
};
const API_BASE = runtimeMeta.env?.VITE_API_URL ?? "";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, init);
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const body = (await response.json()) as { detail?: string };
      message = body.detail ?? message;
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

export function rolloutSession(
  sessionId: string,
  frames: DemonstrationFrame[],
  current: number[],
  timestepMs: number,
  maxSteps: number,
  approachMode: "scripted" | "learned" = "scripted",
) {
  return request<{ frames: RolloutFrame[]; steps: number; collisions: number }>(
    `/api/sessions/${sessionId}/rollout`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        frames,
        current,
        timestep_ms: timestepMs,
        max_steps: maxSteps,
        approach_mode: approachMode,
      }),
    },
  );
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
