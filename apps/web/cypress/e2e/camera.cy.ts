import { openCameraPage, setupTab, robotSettings, stubLandmarks } from "../support/cameraFixture";
import { seedCameraRecording } from "../support/seedCameraRecording";
function offlineCapture() {
  setupTab(); cy.get('[aria-label="Processing mode"]').select('offline');
  cy.contains('button', 'Test all cameras').click();
  cy.contains('Camera ready to record', { timeout: 30000 }).should('exist');
  cy.contains('[role="tab"]', 'Live camera').click();
}
function recordClip() {
  cy.get('[aria-label="Countdown"]').select('1');
  cy.contains('button', 'Start recording').should('be.enabled').click();
  cy.contains('button', 'Stop recording', { timeout: 10000 }).should('exist'); cy.wait(1100);
  cy.contains('button', 'Stop recording').click();
  cy.contains('Recording saved on this device', { timeout: 20000 }).should('exist');
}
describe('Camera recordings and control', () => {
  it('keeps source selections independent and exposes calibration and timing blockers', () => {
    openCameraPage(); setupTab();
    cy.get('[aria-label="Camera count"]').select('2');
    cy.get('[aria-label="Camera 2 source"]').select('ip');
    cy.get('[aria-label="Camera 2 IP URL"]').type('http://camera-two/video');
    cy.get('[aria-label="3D reconstruction"]').select('triangulated');
    cy.contains('button', 'Run on physical robot').should('be.disabled');
    cy.contains('[role="tab"]', 'Calibration').click();
    cy.get('[aria-label="Camera calibration JSON"]').should('be.visible');
    cy.contains('Timing unverified').should('exist');
    setupTab(); cy.get('[aria-label="Camera count"]').select('1');
    cy.get('[aria-label="Camera 2 source"]').should('not.exist');
    cy.contains('button', 'Run on physical robot').should('be.enabled');
  });
  it('keeps DDS and ROS bridge settings aligned on desktop and mobile', () => {
    openCameraPage(); robotSettings();
    cy.get('[aria-label="Robot connection"]').should('have.value', 'unitree-sdk2').select('unitree-rosbridge');
    cy.get('[aria-label="Robot network interface"]').should('not.exist');
    cy.get('[aria-label="Robot ROS bridge URL"]').should('have.value', 'ws://192.168.123.164:9090');
    for (const width of [1280,390]) {
      cy.viewport(width, 900);
      cy.get('[aria-label="Robot connection controls"] input, [aria-label="Robot connection controls"] select, [aria-label="Robot connection controls"] button').filter(':visible').each($control => {
        const rect = $control[0].getBoundingClientRect(); expect(rect.left).to.be.at.least(0); expect(rect.right).to.be.at.most(width);
      });
    }
    cy.get('[aria-label="Robot ROS bridge URL"]').clear();
    cy.contains('button', 'Run on physical robot').should('be.disabled');
  });
  for (const scope of ['single', 'g1-upper-body']) {
    it(`runs ${scope} control with held or mapped waist and explicit release`, () => {
      const target = scope === 'single' ? { right_elbow_joint: .4 }
        : { right_elbow_joint: .4, left_elbow_joint: .3, waist_yaw_joint: .1, waist_roll_joint: .1, waist_pitch_joint: -.1 };
      stubLandmarks(); openCameraPage(true, { width: 320, height: 240 }, target, true);
      cy.get('[aria-label="Mapping scope"]').select(scope);
      robotSettings(); cy.get('[aria-label="Robot connection"]').select('mock');
      cy.contains('button', 'Run on mock robot').click();
      cy.contains('button', 'Stop robot', { timeout: 45000 }).should('be.enabled');
      cy.get('[aria-label="Mapping scope"]').should('be.disabled');
      cy.contains('summary', 'Measured and commanded upper-body positions').click();
      cy.contains('tr', 'right_elbow_joint', { timeout: 15000 }).find('td').eq(3).should($cell => expect(Number($cell.text())).to.be.greaterThan(.05));
      cy.contains('tr', 'waist_yaw_joint').find('td').eq(3).should($cell => scope === 'single' ? expect(Number($cell.text())).to.equal(0) : expect(Number($cell.text())).to.be.greaterThan(.01));
      if (scope === 'single') cy.contains('tr', 'left_elbow_joint').find('td').eq(3).should('have.text', '0.000');
      else {
        cy.contains('tr', 'waist_roll_joint').find('td').eq(3).should($cell => expect(Number($cell.text())).to.be.greaterThan(.01));
        cy.contains('tr', 'waist_pitch_joint').find('td').eq(3).should($cell => expect(Number($cell.text())).to.be.lessThan(-.01));
      }
      cy.contains('button', 'Stop robot').click();
      cy.contains('Disarmed · motor commands are not being published.').should('exist');
      cy.contains('button', 'Disconnect robot').click();
      cy.get('[aria-label="Mapping scope"]').should('be.enabled');
      cy.contains('button', 'Close cameras').filter(':visible').first().click();
    });
  }
  for (const dimensions of [{ width: 1280, height: 720 }, { width: 720, height: 1280 }]) {
    it(`shows the entire ${dimensions.width}×${dimensions.height} frame without clipping`, () => {
      cy.viewport(1280, 900); openCameraPage(true, dimensions); offlineCapture();
      cy.contains(`${dimensions.width} × ${dimensions.height} · entire camera frame`).should('exist');
      cy.get('.camera-source-panel video').should($video => {
        const video = $video[0] as HTMLVideoElement;
        expect(video.videoWidth).to.equal(dimensions.width); expect(video.videoHeight).to.equal(dimensions.height);
        expect(getComputedStyle(video).objectFit).to.equal('contain');
      });
      cy.contains('button', 'Expand camera').click(); cy.get('.camera-source-expanded').should('exist');
      cy.contains('button', 'Expand robot').click(); cy.get('.camera-source-container').should('not.be.visible');
      cy.contains('button', 'Start recording').should('be.enabled');
      cy.contains('button', 'Show camera').click(); cy.get('.camera-source-container').should('be.visible');
      cy.viewport(390, 844); cy.window().then(win => expect(win.document.documentElement.scrollWidth).to.be.at.most(win.innerWidth));
      cy.contains('button', 'Reduce camera').click(); cy.contains('button', 'Close cameras').filter(':visible').first().click();
    });
  }
  it('reopens landmarks, plays both previews and preserves the Archive when local media is deleted', () => {
    openCameraPage(); seedCameraRecording(); cy.reload(); cy.wait('@defaultRobot'); cy.wait('@createCameraSession');
    cy.contains('button', 'Start live preview').should('be.enabled');
    cy.contains('[role="tab"]', 'Recordings').click(); cy.contains('button', 'Saved movement').click();
    cy.get('[aria-label="Extracted stick figure"] line').should('have.length.greaterThan', 5);
    cy.contains('button', /^Play$/).click(); cy.contains('button', /^Pause$/).should('exist');
    cy.contains('button', 'Restart').click(); cy.get('[aria-label="Playback time"]').should('contain', '0.00');
    cy.contains('button', 'Next frame').click(); cy.get('[aria-label="Playback time"]').should('contain', '0.10');
    cy.get('[aria-label="Playback speed"]').select('0.5'); cy.get('[aria-label="Inspection mode"]').select('robot');
    cy.get('[aria-label="Playback time"]').should('contain', '0.10'); cy.get('[aria-label="Inspection mode"]').select('side-by-side');
    cy.contains('button', 'Save robot gesture').click();
    cy.get('@saveDemo.all').should((requests: any) => expect(requests.some((request: any) => request.request.body.demonstrations.some((demo: any) => demo.name === 'Saved movement' && demo.frames.length === 11))).to.equal(true));
    cy.viewport(390, 844); cy.window().then(win => expect(win.document.documentElement.scrollWidth).to.be.at.most(win.innerWidth));
    cy.contains('button', 'Delete local recording').click(); cy.contains('a', 'Archive').click(); cy.contains('Saved movement').should('exist');
  });
  it('extracts real retained video and returns to live capture without tearing down recording inspection', () => {
    openCameraPage(true); offlineCapture(); recordClip();
    cy.contains('button', 'Close cameras').filter(':visible').first().click(); cy.contains('[role="tab"]', 'Recordings').click();
    cy.get('.camera-recorded-source').should('be.visible');
    cy.contains('button', 'Extract stick figure').click();
    cy.contains('No confident pose found', { timeout: 120000 }).should('exist');
    cy.contains('button', 'Re-extract stick figure').should('be.enabled');
    setupTab(); cy.get('[aria-label="Processing mode"]').select('live'); cy.get('[aria-label="Landmark detector"]').select('pose');
    cy.contains('button', 'Start live preview').click(); cy.contains('Live preview ready', { timeout: 120000 }).should('exist');
    cy.contains('[role="tab"]', 'Live camera').click();
    cy.get('.camera-source-panel svg').should('have.attr', 'viewBox', '0 0 320 240');
    cy.get('.camera-live-preview').should($stage => {
      const video = $stage[0].querySelector('video')!.getBoundingClientRect(), overlay = $stage[0].querySelector('svg')!.getBoundingClientRect();
      expect(overlay.width).to.be.closeTo(video.width, 1); expect(overlay.height).to.be.closeTo(video.height, 1);
    });
    cy.contains('button', 'Close cameras').filter(':visible').first().click();
  });
  it('records browser-readable IP pixels for later extraction', () => {
    openCameraPage(); setupTab();
    cy.intercept('GET', '/test-camera.svg', { headers: { 'content-type': 'image/svg+xml', 'access-control-allow-origin': '*' }, body: '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90"><rect width="160" height="90" fill="gray"/></svg>' });
    cy.get('[aria-label="Video source"]').select('ip'); cy.get('[aria-label="IP camera URL"]').type(`${Cypress.config('baseUrl')}/test-camera.svg`);
    offlineCapture(); recordClip(); cy.contains('[role="tab"]', 'Recordings').click();
    cy.contains('button', 'Extract stick figure').should('be.enabled');
  });
});
