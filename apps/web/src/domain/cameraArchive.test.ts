import { beforeEach, expect, it } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import {
  deleteCameraRecording,
  listCameraRecordings,
  loadCameraRecording,
  saveCameraRecording,
  type CameraRecording,
} from "./cameraArchive";
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});
const recording: CameraRecording = {
  id: "new",
  name: "New video",
  created_at: "2026-09-19",
  source: { kind: "local-media-stream", stream_count: 1 },
  sample_rate: 15,
  duration_ms: 1000,
  frames: [],
  video: new Blob(["video"], { type: "video/webm" }),
};
it("lists and reopens robot-scoped videos and persists extraction without losing pixels", async () => {
  await saveCameraRecording("one", recording);
  await saveCameraRecording("two", { ...recording, name: "Other robot" });
  expect(await listCameraRecordings("one")).toMatchObject([{ name: "New video", has_video: true, frame_count: 0 }]);
  const { video, ...metadata } = recording;
  await saveCameraRecording("one", {
    ...metadata,
    processed: true,
    frames: [{ timestamp: 0, pose: [], left_hand: [], right_hand: [], confidence: 1 }],
  });
  const reopened = await loadCameraRecording("one", "new");
  expect(reopened?.video?.size).toBe(video?.size);
  expect(reopened?.frames).toHaveLength(1);
  await deleteCameraRecording("one", "new");
  expect(await loadCameraRecording("one", "new")).toBeNull();
  expect(await listCameraRecordings("two")).toHaveLength(1);
});
it("recovers version-two orphan videos and normalizes legacy landmark timestamps", async () => {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open("robot-learning-workbench-camera-v1", 2);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("videos");
      request.result.createObjectStore("captures");
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(["videos", "captures"], "readwrite");
      tx.objectStore("videos").put(recording.video, "one:camera-1000");
      tx.objectStore("captures").put(
        {
          ...recording,
          id: "legacy",
          frames: [200, 300].map((timestamp) => ({
            timestamp,
            pose: [],
            left_hand: [],
            right_hand: [],
            confidence: 1,
          })),
        },
        "one:legacy",
      );
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
    };
  });
  expect(await listCameraRecordings("one")).toHaveLength(2);
  expect((await loadCameraRecording("one", "legacy"))?.frames.map((frame) => frame.timestamp)).toEqual([0, 100]);
  expect((await loadCameraRecording("one", "camera-1000"))?.video?.size).toBe(recording.video?.size);
});
it("retains every camera video and its timing when reopening and replacing multi-view extraction",async()=> {
  const views=[1,2,3].map(i=>({id:`view-${i}`,source:{kind:"local-media-stream" as const,stream_count:1 as const},
    offset_ms:i-1,duration_ms:1000,frames:[],video:new Blob([`camera ${i}`],{type:"video/webm"})}));
  await saveCameraRecording("one",{...recording,source:{kind:"multi-camera",stream_count:3,model:"body-aligned"},views});
  const reopened=(await loadCameraRecording("one","new"))!;
  expect(reopened.views?.map(v=>v.video?.size)).toEqual(views.map(v=>v.video.size));
  expect(reopened.views?.map(v=>v.offset_ms)).toEqual([0,1,2]);
  const {video,views:retained,...metadata}=reopened;
  await saveCameraRecording("one",{...metadata,views:retained?.map(({video:_video,...view})=>view),processed:true});
  const processed=(await loadCameraRecording("one","new"))!;
  expect(processed.video?.size).toBe(video?.size);
  expect(processed.views?.map(v=>v.video?.size)).toEqual(views.map(v=>v.video.size));
  const summary=(await listCameraRecordings("one"))[0];
  expect(summary).not.toHaveProperty("views");
  await deleteCameraRecording("one","new");
  expect(await loadCameraRecording("one","new")).toBeNull();
});
