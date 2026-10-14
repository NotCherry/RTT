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
export function openCameraPage(fakeCamera = false, dimensions = { width: 320, height: 240 }, fakeArmTargets: boolean | Record<string, number> = false, transientCongestion = false) {
  cy.intercept("GET", "/api/robots/demo", { body: robot });
  cy.intercept("GET", "/api/robots/default", { body: robot }).as("defaultRobot");
  cy.intercept("POST", "/api/sessions", {
    body: { session_id: "camera-session", robot, state: { type: "state", positions: [0], training: false } },
  }).as("createCameraSession");
  cy.intercept("PUT", "/api/sessions/camera-session/demonstrations", { body: { status: "saved" } }).as("saveDemo");
  cy.intercept("PUT", "/api/sessions/camera-session/datasets", { body: { status: "saved" } });
  cy.visit("/teach/pose", {
    onBeforeLoad(win) {
      if (transientCongestion) {
        const buffered = Object.getOwnPropertyDescriptor(win.WebSocket.prototype, "bufferedAmount")!.get!;
        let reads = 0;
        Object.defineProperty(win.WebSocket.prototype, "bufferedAmount", { configurable: true, get() {
          return this.url.includes("/api/robot-transport/stream") && ++reads % 3 === 0 ? 32 : buffered.call(this);
        } });
      }
      if (fakeArmTargets) {
        // Supply deterministic arm targets at the transport seam.
        // Exercise the real authenticated stream and mock controller without hardware.
        const send = win.WebSocket.prototype.send;
        win.WebSocket.prototype.send = function (data) {
          if (this.url.includes("/api/robot-transport/stream") && typeof data === "string") {
            const packet = JSON.parse(data);
            if ("tracking" in packet) data = JSON.stringify({ ...packet, tracking: true,
              positions: typeof fakeArmTargets === "object" ? fakeArmTargets : { right_shoulder_roll_joint: .4 } });
          }
          send.call(this, data);
        };
      }
      if (!fakeCamera) return;
      Object.defineProperty(win.navigator.mediaDevices,"enumerateDevices",{configurable:true,value:async()=>[1,2,3].map(i=>({kind:"videoinput",deviceId:`camera-${i}`,label:`Test camera ${i}`,groupId:`group-${i}`}))});
      Object.defineProperty(win.navigator.mediaDevices, "getUserMedia", {
        configurable: true,
        value: async (constraints: MediaStreamConstraints) => {
          expect((constraints.video as MediaTrackConstraints & { resizeMode: string }).resizeMode).to.equal("none");
          const canvas = win.document.createElement("canvas");
          canvas.width = dimensions.width;
          canvas.height = dimensions.height;
          const context = canvas.getContext("2d")!;
          const stream = canvas.captureStream(10);
          const deviceId=(constraints.video as MediaTrackConstraints).deviceId;
          stream.getVideoTracks().forEach(track=>{const settings=track.getSettings.bind(track);track.getSettings=()=>({...settings(),deviceId:typeof deviceId==="object"?String(deviceId.exact):"camera-1"});});
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

export function setupTab() { cy.contains('[role="tab"]', 'Camera setup').click().should('have.attr', 'aria-selected', 'true'); }
export function robotSettings() { cy.contains('summary', 'Robot settings and diagnostics').click(); }
export function stubLandmarks() {
  // Simulate perception only; use the actual camera lifecycle, owned stream and backend mock motors.
  const pose = Array.from({ length: 33 }, () => ({ x: .5, y: .5, z: 0, visibility: 1 }));
  for (const [index, x, y] of [[11, .65, .2], [12, .35, .2], [13, .65, .4], [14, .35, .4], [15, .65, .6], [16, .35, .6], [23, .6, .5], [24, .4, .5]]) pose[index] = { x, y, z: 0, visibility: 1 };
  const frame = { pose, pose_world: pose, left_hand: [], right_hand: [], confidence: 1, source_width: 320, source_height: 240 };
  cy.intercept('GET', '**/src/domain/cameraProcessing.ts*', { statusCode: 200, headers: { 'content-type': 'application/javascript' }, body:
    `export async function createCameraDetector(){ return { mode: 'worker', close() {} }; }
     export async function detectCameraFrame(detector,source,timestamp){ return { timestamp, ...${JSON.stringify(frame)} }; }
     export async function extractCameraRecording(){ throw new Error('Not available in the perception fixture'); }` });
}
