import type { CameraCapture, LandmarkFrame } from "@/types";
import type { CameraViewRecording } from "./multiCameraContract";

export type CameraRecording = {
  id: string;
  name: string;
  created_at: string;
  source: CameraCapture["source"];
  detector?: import("./cameraDetectorModels").CameraDetectorModel;
  sample_rate: CameraCapture["sample_rate"];
  duration_ms: number;
  width?: number;
  height?: number;
  frames: LandmarkFrame[];
  rejected_frames?: number;
  processed?: boolean;
  video?: Blob;
  views?: CameraViewRecording[];
  recording_start_ms?: number;
};
export type CameraRecordingSummary = Omit<CameraRecording, "video" | "frames" | "views"> & {
  frame_count: number;
  has_video: boolean;
};
const DATABASE = "robot-learning-workbench-camera-v1";
const stores = ["captures", "videos", "recordings"];

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 3);
    request.onupgradeneeded = () => {
      for (const store of stores)
        if (!request.result.objectStoreNames.contains(store)) request.result.createObjectStore(store);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Close other workbench tabs and retry local storage."));
    request.onsuccess = () => resolve(request.result);
  });
}

async function transaction<T>(
  names: string[],
  mode: IDBTransactionMode,
  work: (tx: IDBTransaction, result: (value: T) => void) => void,
): Promise<T> {
  const database = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = database.transaction(names, mode);
      let value: T;
      tx.oncomplete = () => resolve(value);
      tx.onerror = tx.onabort = () => reject(tx.error ?? new Error("Local camera storage failed."));
      work(tx, (next) => {
        value = next;
      });
    });
  } finally {
    database.close();
  }
}

export async function saveCameraRecording(robotId: string, recording: CameraRecording) {
  const { video, views, ...metadata } = recording;
  const viewMetadata = views?.map(({video: _video, ...view}) => view);
  return transaction<void>(["recordings", "videos"], "readwrite", (tx) => {
    const key = `${robotId}:${recording.id}`;
    tx.objectStore("recordings").put({...metadata, ...(viewMetadata ? {views:viewMetadata} : {})}, key);
    if (video) tx.objectStore("videos").put(views ? {video,views:views.map(v=>({id:v.id,video:v.video}))} : video, key);
  });
}

/** Read legacy captures and orphan videos too; upgrade without discarding old data. */
async function readRecordings(robotId: string) {
  return transaction<Map<string, CameraRecording>>(stores, "readonly", (tx, result) => {
    const rows = new Map<string, CameraRecording>();
    const captures = new Map<string, CameraCapture>();
    const videos = new Map<string, Blob | {video:Blob;views:{id:string;video?:Blob}[]}>();
    let pending = stores.length;
    for (const name of stores) {
      const request = tx.objectStore(name).openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          const key = String(cursor.key);
          if (key.startsWith(`${robotId}:`)) {
            const id = key.slice(robotId.length + 1);
            if (name === "recordings") rows.set(id, cursor.value);
            if (name === "captures") captures.set(id, cursor.value);
            if (name === "videos") videos.set(id, cursor.value);
          }
          cursor.continue();
        } else if (--pending === 0) {
          for (const id of new Set([...captures.keys(), ...videos.keys()])) {
            const capture = captures.get(id);
            if (!rows.has(id))
              rows.set(id, {
                id,
                name: capture?.name ?? "Recovered recording",
                created_at:
                  capture?.created_at ??
                  (Number.isFinite(Number(id.replace("camera-", "")))
                    ? new Date(Number(id.replace("camera-", ""))).toISOString()
                    : ""),
                source: capture?.source ?? { kind: "local-media-stream", stream_count: 1 },
                sample_rate: capture?.sample_rate ?? 15,
                duration_ms: capture?.frames.length
                  ? capture.frames.at(-1)!.timestamp - capture.frames[0].timestamp
                  : 0,
                frames:
                  capture?.frames.map((frame) => ({
                    ...frame,
                    timestamp: frame.timestamp - capture.frames[0].timestamp,
                  })) ?? [],
                processed: Boolean(capture?.frames.length),
              });
          }
          for (const [id, value] of videos) {
            const row=rows.get(id)!;
            if ("views" in value) {
              row.video=value.video;
              row.views=row.views?.map(v=>({...v,video:value.views.find(saved=>saved.id===v.id)?.video}));
            } else row.video=value;
          }
          result(rows);
        }
      };
    }
  });
}

export async function listCameraRecordings(robotId: string): Promise<CameraRecordingSummary[]> {
  const rows = await readRecordings(robotId);
  return [...rows.values()]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map(({ video, frames, views: _views, ...row }) => ({ ...row, frame_count: frames.length, has_video: Boolean(video) }));
}
export async function loadCameraRecording(robotId: string, id: string) {
  return (await readRecordings(robotId)).get(id) ?? null;
}
export async function deleteCameraRecording(robotId: string, id: string) {
  return transaction<void>(stores, "readwrite", (tx) => {
    for (const name of stores) tx.objectStore(name).delete(`${robotId}:${id}`);
  });
}
export async function saveCameraCapture(robotId: string, capture: CameraCapture) {
  return transaction<void>(["captures"], "readwrite", (tx) => {
    tx.objectStore("captures").put(capture, `${robotId}:${capture.id}`);
  });
}
export async function deleteCameraCapture(robotId: string, id: string) {
  return transaction<void>(["captures"], "readwrite", (tx) => {
    tx.objectStore("captures").delete(`${robotId}:${id}`);
  });
}
