export function seedCameraRecording() {
    cy.window().then(
      (win) =>
        new Promise<void>((resolve, reject) => {
          const request = win.indexedDB.open("robot-learning-workbench-camera-v1", 3);
          request.onupgradeneeded = () => {
            for (const store of ["captures", "videos", "recordings"])
              if (!request.result.objectStoreNames.contains(store)) request.result.createObjectStore(store);
          };
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const db = request.result;
            const tx = db.transaction("recordings", "readwrite");
            tx.objectStore("recordings").put(
              {
                id: "fixture",
                name: "Saved movement",
                created_at: new Date().toISOString(),
                source: { kind: "local-media-stream", stream_count: 1 },
                sample_rate: 10,
                duration_ms: 1000,
                processed: true,
                frames: Array.from({ length: 11 }, (_, frame) => ({
                  timestamp: frame * 100,
                  confidence: 1,
                  pose: Array.from({ length: 33 }, (_, i) => ({
                    x: 0.3 + (i % 2) * 0.3,
                    y: 0.1 + i / 45 + frame / 150,
                    z: 0,
                    visibility: 1,
                  })),
                  left_hand: [],
                  right_hand: [],
                })),
              },
              "camera-test:fixture",
            );
            tx.oncomplete = () => {
              db.close();
              resolve();
            };
          };
        }),
    );

}
