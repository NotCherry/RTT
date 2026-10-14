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
function openCameraPage(fakeCamera = false, dimensions = { width: 320, height: 240 }, fakeArmTargets: boolean | Record<string, number> = false, transientCongestion = false) {
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

function setupTab() { cy.contains('[role="tab"]', 'Camera setup').click().should('have.attr', 'aria-selected', 'true'); }
function robotSettings() { cy.contains('summary', 'Robot settings and diagnostics').click(); }
function stubLandmarks() {
  // Simulate perception only; use the actual camera lifecycle, owned stream and backend mock motors.
  const pose = Array.from({ length: 33 }, () => ({ x: .5, y: .5, z: 0, visibility: 1 }));
  for (const [index, x, y] of [[11, .65, .2], [12, .35, .2], [13, .65, .4], [14, .35, .4], [15, .65, .6], [16, .35, .6], [23, .6, .5], [24, .4, .5]]) pose[index] = { x, y, z: 0, visibility: 1 };
  const frame = { pose, pose_world: pose, left_hand: [], right_hand: [], confidence: 1, source_width: 320, source_height: 240 };
  cy.intercept('GET', '**/src/domain/cameraProcessing.ts', req => {
    delete req.headers['if-none-match'];
    req.continue(res => {
    const marker = 'const result = detector.detectForVideo(source, timestamp);';
    expect(res.body).to.contain(marker);
    res.body = res.body.replace('export async function createCameraDetector() {', 'export async function createCameraDetector() { return { close() {} };')
      .replace(marker, `return { timestamp, ...${JSON.stringify(frame)} }; ${marker}`);
    });
  });
}
describe('Camera workspace', () => {
  it('selects and saves three independent sources and shows all views together', () => {
    openCameraPage(true);
    setupTab();
    cy.get('[aria-label="Camera count"]').select('3');
    for (const i of [1, 2, 3]) cy.get(`[aria-label="USB camera ${i}"]`).select(`camera-${i}`);
    cy.contains('button', 'Save setup').click();
    for (const width of [1280, 390]) {
      cy.viewport(width, 900);
      cy.get('.camera-workspace-grid .camera-source-panel').should('have.length', 3).each($panel => {
        const rect = $panel[0].getBoundingClientRect();
        expect(rect.left).to.be.at.least(0); expect(rect.right).to.be.at.most(width);
      });
      cy.window().then(win => expect(win.document.documentElement.scrollWidth).to.be.at.most(win.innerWidth));
    }
    cy.reload(); cy.wait('@defaultRobot'); cy.wait('@createCameraSession');
    cy.contains('button', 'Start live preview').should('be.enabled'); setupTab();
    cy.get('[aria-label="Camera count"]').should('have.value', '3');
    cy.window().then(win => {
      const saved = JSON.parse(win.localStorage.getItem('rtt-camera-setup-v1:camera-test')!);
      expect(saved.inputs.map(input => input.deviceId)).to.deep.equal(['camera-1', 'camera-2', 'camera-3']);
    });
    setupTab();
    cy.get('[aria-label="Camera 2 source"]').select('ip');
    cy.get('[aria-label="Camera 2 IP URL"]').type('http://camera-two/video');
    cy.get('[aria-label="3D reconstruction"]').select('triangulated');
    cy.contains('[role="tab"]', 'Calibration').click();
    cy.get('[aria-label="Camera calibration JSON"]').should('be.visible');
  });
  it('records three views and retains capture while inspecting recordings', () => {
    openCameraPage(true); setupTab();
    cy.get('[aria-label="Camera count"]').select('3');
    for (const i of [1, 2, 3]) cy.get(`[aria-label="USB camera ${i}"]`).select(`camera-${i}`);
    cy.get('[aria-label="Processing mode"]').select('offline');
    cy.contains('button', 'Test all cameras').click();
    cy.contains('Camera 3: Camera ready to record', { timeout: 30000 }).should('exist');
    cy.contains('[role="tab"]', 'Live camera').click();
    cy.get('[aria-label="Countdown"]').select('1');
    cy.contains('button', 'Start recording').click();
    cy.contains('button', 'Stop recording', { timeout: 10000 }).should('exist'); cy.wait(1100);
    cy.contains('button', 'Stop recording').click();
    cy.contains('Recording saved on this device', { timeout: 20000 }).should('exist');
    cy.get('[aria-selected="true"]').should('have.text', 'Live camera');
    cy.get('.camera-source-panel video').each($video => expect(($video[0] as HTMLVideoElement).srcObject).not.to.equal(null));
    cy.contains('[role="tab"]', 'Recordings').click();
    cy.contains('button', 'Export camera videos').should('exist');
    cy.contains('[role="tab"]', 'Camera setup').click();
    cy.get('[aria-label="Camera count"]').should('be.disabled');
    cy.contains('button', 'Close cameras').filter(':visible').first().click();
    cy.get('[aria-label="Camera count"]').should('be.enabled');
  });
  it('starts the preview directly and never opens a robot connection', () => {
    cy.intercept('POST', '/api/robot-transport/connect', req => { throw new Error('Preview must not connect hardware'); });
    openCameraPage(true);
    cy.contains('button', 'Start live preview').click();
    cy.contains('Live preview ready', { timeout: 120000 }).should('exist');
    cy.contains('[role="tab"]', 'Camera setup').click();
    cy.contains('Live processing ready').should('exist');
    cy.get('[aria-label="Camera count"]').should('be.disabled');
    cy.contains('button', 'Close cameras').filter(':visible').first().click();
    cy.get('[aria-label="Camera count"]').should('be.enabled');
  });
  it('opens, processes, connects and arms through one explicit Run action', () => {
    stubLandmarks(); openCameraPage(true);
    robotSettings(); cy.get('[aria-label="Robot connection"]').select('mock');
    cy.intercept('POST', '/api/robot-transport/arm').as('armRobot');
    cy.contains('button', 'Run on mock robot').click();
    cy.contains('button', 'Stop robot', { timeout: 45000 }).should('be.enabled');
    cy.wait('@armRobot').its('response.body.armed').should('equal', true);
    cy.contains('button', 'Stop robot', { timeout: 15000 }).should('be.enabled').click();
    cy.contains('button', 'Close cameras').filter(':visible').should('exist');
    cy.contains('button', 'Disconnect robot').click();
    cy.contains('button', 'Run on mock robot').should('be.enabled');
    cy.contains('button', 'Close cameras').filter(':visible').first().click();
  });
});
