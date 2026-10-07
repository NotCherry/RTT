/// <reference types="cypress" />
const robot = {
  id: "camera-test",
  name: "Camera test robot",
  filename: "camera.urdf",
  root: "base",
  links: [
    { name: "base", visuals: [] },
    { name: "arm", visuals: [] },
  ],
  joints: [
    {
      name: "right_shoulder_roll_joint",
      type: "revolute",
      parent: "base",
      child: "arm",
      origin: { xyz: [0, 0, 0], rpy: [0, 0, 0] },
      axis: [0, 1, 0],
      lower: -3,
      upper: 3,
      controllable: true,
    },
  ],
};
function openCameraPage(fakeCamera = false, dimensions = { width: 320, height: 240 }, fakeArmTargets = false) {
  cy.intercept("GET", "/api/robots/demo", { body: robot });
  cy.intercept("GET", "/api/robots/default", { body: robot }).as("defaultRobot");
  cy.intercept("POST", "/api/sessions", {
    body: { session_id: "camera-session", robot, state: { type: "state", positions: [0], training: false } },
  }).as("createCameraSession");
  cy.intercept("PUT", "/api/sessions/camera-session/demonstrations", { body: { status: "saved" } }).as("saveDemo");
  cy.intercept("PUT", "/api/sessions/camera-session/datasets", { body: { status: "saved" } });
  cy.visit("/teach/pose", {
    onBeforeLoad(win) {
      if (fakeArmTargets) {
        // Supply deterministic arm targets at the transport seam.
        // Exercise the real authenticated stream and mock controller without hardware.
        const send = win.WebSocket.prototype.send;
        win.WebSocket.prototype.send = function (data) {
          if (this.url.includes("/api/robot-transport/stream") && typeof data === "string") {
            const packet = JSON.parse(data);
            if ("tracking" in packet) data = JSON.stringify({ ...packet, tracking: true, positions: { right_shoulder_roll_joint: .4 } });
          }
          send.call(this, data);
        };
      }
      if (!fakeCamera) return;
      Object.defineProperty(win.navigator.mediaDevices, "getUserMedia", {
        configurable: true,
        value: async (constraints: MediaStreamConstraints) => {
          expect((constraints.video as MediaTrackConstraints & { resizeMode: string }).resizeMode).to.equal("none");
          const canvas = win.document.createElement("canvas");
          canvas.width = dimensions.width;
          canvas.height = dimensions.height;
          const context = canvas.getContext("2d")!;
          const stream = canvas.captureStream(10);
          let frame = 0;
          const timer = win.setInterval(() => {
            context.fillStyle = frame++ % 2 ? "#333" : "#444";
            context.fillRect(0, 0, dimensions.width, dimensions.height);
            context.fillStyle = "#2687e8";
            context.fillRect(0, 0, dimensions.width, 16);
            context.fillStyle = "#e85826";
            context.fillRect(0, dimensions.height - 16, dimensions.width, 16);
            if (stream.getTracks().every((track) => track.readyState === "ended")) win.clearInterval(timer);
          }, 100);
          return stream;
        },
      });
    },
  });
  cy.wait("@defaultRobot");
  cy.wait("@createCameraSession");
  cy.contains("a", "Camera").click();
}
describe("Camera recordings", () => {
  it("shows disarmed camera targets and produces commands only after explicit arming", () => {
    openCameraPage(true, { width: 320, height: 240 }, true);
    cy.get('[aria-label="Processing mode"]').select("live");
    cy.contains("button", "Open camera").click();
    cy.contains("Live processing ready", { timeout: 120000 }).should("exist");
    cy.contains("button", "Connect mock robot").click();
    cy.contains("Live arm targets are reaching the backend.", { timeout: 15000 }).should("exist");
    cy.contains("Disarmed · motor commands are not being published.").should("exist");
    cy.contains("summary", "Measured and commanded arm positions").click();
    cy.contains("tr", "right_shoulder_roll_joint").within(() => {
      cy.get("td").eq(2).should("have.text", "0.400");
      cy.get("td").eq(3).should("have.text", "—");
    });
    cy.get('[aria-label="Robot connection controls"]').should("contain.text", "0 packets");
    cy.intercept("POST", "/api/robot-transport/arm").as("armMock");
    cy.contains("button", "Arm live control").should("be.enabled").click();
    cy.wait("@armMock").its("response.body.armed").should("equal", true);
    cy.contains("tr", "right_shoulder_roll_joint", { timeout: 15000 }).find("td").eq(3)
      .should($cell => expect(Number($cell.text())).to.be.greaterThan(0));
    cy.contains("button", "Stop / disarm").click();
    cy.contains("Disarmed · motor commands are not being published.").should("exist");
    cy.contains("button", "Disconnect robot").click();
    cy.contains("button", "Connect mock robot").should("exist");
  });

  for (const dimensions of [{ width: 1280, height: 720 }, { width: 720, height: 1280 }]) {
    it(`fits the entire ${dimensions.width}×${dimensions.height} live frame and expands without clipping`, () => {
      cy.viewport(1280, 900);
      openCameraPage(true, dimensions);
      cy.contains("button", "Open camera").click();
      cy.contains("button", "Start recording").should("be.enabled");
      cy.contains(`${dimensions.width} × ${dimensions.height} · entire camera frame`).should("exist");
      cy.get(".camera-source-panel").should(($panel) => {
        const panel = $panel[0].getBoundingClientRect();
        const video = $panel[0].querySelector("video")!;
        const frame = video.getBoundingClientRect();
        expect(video.videoWidth).to.equal(dimensions.width);
        expect(video.videoHeight).to.equal(dimensions.height);
        expect(getComputedStyle(video).objectFit).to.equal("contain");
        expect(frame.bottom).to.be.lessThan(panel.bottom);
        expect(frame.height).to.be.at.least(360);
      });
      cy.contains("button", "Expand camera").click();
      cy.get(".camera-source-expanded").should("exist");
      cy.get(".camera-live-preview").should(($stage) => expect($stage[0].getBoundingClientRect().height).to.be.at.least(650));
      cy.get(".camera-capture-panel").should(($panel) => {
        const capture = $panel[0];
        const source = capture.previousElementSibling!.getBoundingClientRect();
        expect(capture.getBoundingClientRect().width).to.be.closeTo(source.width, 1);
        expect(capture.querySelector(".route-actions")!.getBoundingClientRect().bottom)
          .to.be.at.most(capture.querySelector(".camera-live-robot")!.getBoundingClientRect().top);
      });
      cy.contains("button", "Expand robot").click();
      cy.get(".camera-source-container").should("not.be.visible");
      cy.get(".camera-live-robot").should(($robot) => expect($robot[0].getBoundingClientRect().height).to.be.at.least(480));
      cy.contains("button", "Start recording").should("be.enabled");
      cy.screenshot(`camera-robot-expanded-${dimensions.width}-${dimensions.height}`);
      cy.contains("button", "Show camera").click();
      cy.get(".camera-source-container").should("be.visible");
      cy.screenshot(`camera-live-${dimensions.width}-${dimensions.height}`);
      cy.viewport(390, 844);
      cy.window().then(win => expect(win.document.documentElement.scrollWidth).to.be.at.most(win.innerWidth));
      cy.contains("button", "Reduce camera").click();
      cy.get(".camera-source-expanded").should("not.exist");
      cy.contains("button", "Close camera").click();
    });
  }

  it("reopens stored landmarks, plays both previews, and preserves saved demonstrations on deletion", () => {
    openCameraPage();
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
    cy.reload();
    cy.wait("@defaultRobot");
    cy.wait("@createCameraSession");
    cy.contains("button", "Open camera").should("be.enabled");
    cy.contains("button", /^Recordings$/).click();
    cy.contains("button", "Saved movement").click();
    cy.get('[aria-label="Extracted stick figure"] line').should("have.length.greaterThan", 5);
    cy.contains("button", /^Play$/).click();
    cy.contains("button", /^Pause$/).should("exist");
    cy.contains("button", "Restart").click();
    cy.get('[aria-label="Playback time"]').should("contain", "0.00");
    cy.contains("button", "Next frame").click();
    cy.get('[aria-label="Playback time"]').should("contain", "0.10");
    cy.get('[aria-label="Playback speed"]').select("0.5");
    cy.get('[aria-label="Inspection mode"]').select("robot");
    cy.get('[aria-label="Playback time"]').should("contain", "0.10");
    cy.get('[aria-label="Inspection mode"]').select("side-by-side");
    cy.get('[aria-label="Mapping scope"]').select("single");
    cy.get('[aria-label="Arm selection"]').select("g1-left-arm");
    cy.contains("button", "Save robot gesture").should("be.disabled");
    cy.get('[aria-label="Mapping scope"]').select("g1-full-body");
    cy.get('[aria-label="Mapping scope"]').select("single");
    cy.contains("button", "Save robot gesture").click();
    cy.get("@saveDemo.all").should((requests: any) => {
      expect(
        requests.some((request: any) =>
          request.request.body.demonstrations.some(
            (demo: any) => demo.name === "Saved movement" && demo.frames.length === 11,
          ),
        ),
      ).to.equal(true);
    });
    cy.window().then((win) => expect(win.document.documentElement.scrollWidth).to.be.at.most(win.innerWidth));
    cy.get(".camera-comparison .route-viewport-panel").should(($panel) => {
      expect($panel[0].getBoundingClientRect().height).to.be.at.most(400);
    });
    cy.screenshot("camera-recording-inspector");
    cy.viewport(390, 844);
    cy.window().then((win) => expect(win.document.documentElement.scrollWidth).to.be.at.most(win.innerWidth));
    cy.screenshot("camera-recording-mobile");
    cy.viewport(1280, 900);
    cy.contains("button", "Delete local recording").click();
    cy.contains("a", "Archive").click();
    cy.contains("Saved movement").should("exist");
  });
  it("records then extracts with the camera closed using real browser video and WASM", () => {
    openCameraPage(true);
    cy.get('[aria-label="Processing mode"]').select("offline");
    cy.get('[aria-label="Countdown"]').select("1");
    cy.contains("button", "Open camera").click();
    cy.contains("button", "Start recording").should("be.enabled").click();
    cy.contains("button", "Stop recording", { timeout: 10000 }).should("exist");
    cy.wait(1200);
    cy.contains("button", "Stop recording").click();
    cy.contains("Recording saved on this device", { timeout: 15000 }).should("exist");
    cy.get(".camera-recorded-source").should("be.visible");
    cy.contains("button", /^Play$/).click();
    cy.contains("button", /^Pause$/).click();
    cy.screenshot("camera-video-comparison");
    cy.contains("button", "Extract stick figure").click();
    cy.contains("No confident pose found", { timeout: 120000 }).should("exist");
    cy.contains("button", "Re-extract stick figure").should("be.enabled");
    cy.contains("button", /^Live camera$/).click();
    cy.contains("button", "Open camera").should("be.enabled");
    // A second capture must reconnect to a newly mounted live video element.
    cy.get('[aria-label="Processing mode"]').select("live");
    cy.contains("button", "Open camera").click();
    cy.contains("Live processing ready", { timeout: 120000 }).should("exist");
    cy.get('[aria-label="Preview speed"]').select("5");
    cy.contains("button", "Connect mock robot").click();
    cy.contains("button", "Arm live control").should("be.enabled").click();
    cy.contains("button", "Stop / disarm").should("exist");
    cy.get('[aria-label="Robot connection controls"]', { timeout: 15000 }).should($panel => {
      const packets = $panel.text().match(/(\d+) packets/);
      expect(Number(packets?.[1] ?? 0)).to.be.greaterThan(0);
    });
    cy.contains("button", /Resume/).should("not.exist");
    cy.contains("button", "Stop / disarm").click();
    cy.contains("button", "Arm live control").should("exist");
    cy.contains("button", "Disconnect robot").click();
    cy.contains("button", "Connect mock robot").should("exist");
    cy.get(".camera-source-panel svg").should("have.attr", "viewBox", "0 0 320 240");
    cy.get(".camera-live-preview").should(($stage) => {
      const video = $stage[0].querySelector("video")!.getBoundingClientRect();
      const overlay = $stage[0].querySelector("svg")!.getBoundingClientRect();
      expect(overlay.width).to.be.closeTo(video.width, 1);
      expect(overlay.height).to.be.closeTo(video.height, 1);
    });
    cy.contains("button", "Close camera").click();
  });
  it("records a browser-readable IP image stream for later extraction", () => {
    openCameraPage();
    cy.intercept("GET", "/test-camera.svg", {
      headers: { "content-type": "image/svg+xml", "access-control-allow-origin": "*" },
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90"><rect width="160" height="90" fill="gray"/></svg>',
    });
    cy.get('[aria-label="Video source"]').select("ip");
    cy.get('[aria-label="IP camera URL"]').type(`${Cypress.config("baseUrl")}/test-camera.svg`);
    cy.get('[aria-label="Processing mode"]').select("offline");
    cy.get('[aria-label="Countdown"]').select("1");
    cy.contains("button", "Open camera").click();
    cy.get('[role="status"]').should("have.text", "Camera ready to record; extract landmarks later");
    cy.contains("button", "Start recording").should("be.enabled").click();
    cy.contains("button", "Stop recording", { timeout: 10000 }).should("exist");
    cy.wait(500);
    cy.contains("button", "Stop recording").click();
    cy.contains("Recording saved on this device", { timeout: 15000 }).should("exist");
    cy.contains("button", "Extract stick figure").should("be.enabled");
  });
});
