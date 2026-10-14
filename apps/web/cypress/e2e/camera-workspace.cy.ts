import { openCameraPage, setupTab, robotSettings, stubLandmarks } from "../support/cameraFixture";
describe('Camera workspace', () => {
  it('detects calibration snapshots through the isolated API and blocks robot startup in Calibration', () => {
    openCameraPage(true); setupTab();
    cy.get('[aria-label="Camera count"]').select('2');
    for (const i of [1, 2]) cy.get(`[aria-label="USB camera ${i}"]`).select(`camera-${i}`);
    cy.get('[aria-label="Processing mode"]').select('offline');
    cy.contains('button', 'Test all cameras').click();
    cy.contains('Camera 2: Camera ready to record', { timeout: 30000 }).should('exist');
    cy.contains('[role="tab"]', 'Calibration').click();
    cy.contains('button', 'Run on physical robot').should('be.disabled');
    cy.intercept('POST', '/api/camera-calibration/detect').as('detectBoard');
    cy.contains('button', 'Capture board pose').click();
    cy.wait('@detectBoard', { timeout: 30000 }).its('response.statusCode').should('equal', 200);
    cy.contains('Board needs at least 12 matching corners').should('exist');
    cy.get('[aria-label="view-1 detected board corners"]').should('be.visible');
    cy.contains('button', 'Solve calibration (0/14 poses)').should('be.disabled');
    cy.contains('button', 'Close cameras').filter(':visible').first().click();
  });
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
    cy.viewport(1280, 900); cy.get('.camera-workspace-grid').scrollIntoView();
    cy.screenshot('camera-setup-final-desktop', { capture: 'viewport' });
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
    cy.get('.camera-recorded-views video').should('have.length', 3);
    cy.contains('button', 'Next frame').click();
    cy.get('.camera-recorded-views video').should($videos => {
      expect(($videos[0] as HTMLVideoElement).currentTime).to.be.greaterThan(0);
    });
    cy.contains('[role="tab"]', 'Camera setup').click();
    cy.get('[aria-label="Camera count"]').should('be.disabled');
    cy.contains('button', 'Close cameras').filter(':visible').first().click();
    cy.get('[aria-label="Camera count"]').should('be.enabled');
  });
  it('records a mixed USB and configured IP rig with retained pixels from every source', () => {
    cy.intercept('GET', '/api/camera-gateway/sources', { sources: [{ id: 'side', name: 'Side IP camera' }] });
    let jpeg = '', sequence = 0;
    cy.intercept('GET', '/api/camera-gateway/sources/side/frame', req => req.reply({ epoch: 'fixture-source', sequence: sequence++, jpeg, width: 160, height: 90, source_age_ms: 0 }));
    openCameraPage(true); setupTab();
    cy.window().then(win => { const canvas = win.document.createElement('canvas'); canvas.width = 160; canvas.height = 90;
      const context = canvas.getContext('2d')!; context.fillStyle = '#607080'; context.fillRect(0,0,160,90); jpeg = canvas.toDataURL('image/jpeg').split(',')[1]; });
    cy.get('[aria-label="Camera count"]').select('3');
    for (const i of [1,2]) cy.get(`[aria-label="USB camera ${i}"]`).select(`camera-${i}`);
    cy.get('[aria-label="Camera 3 source"]').select('ip');
    cy.get('[aria-label="Camera 3 IP access"]').select('gateway:side');
    cy.get('[aria-label="Processing mode"]').select('offline');
    cy.contains('button', 'Test all cameras').click();
    cy.contains('Camera 3: Camera ready to record', { timeout: 30000 }).should('exist');
    cy.contains('[role="tab"]', 'Live camera').click(); cy.get('[aria-label="Countdown"]').select('1');
    cy.contains('button', 'Start recording').click(); cy.contains('button', 'Stop recording', { timeout: 10000 }).should('exist'); cy.wait(1100);
    cy.contains('button', 'Stop recording').click(); cy.contains('Recording saved on this device', { timeout: 20000 }).should('exist');
    cy.contains('[role="tab"]', 'Recordings').click(); cy.get('.camera-recorded-views video').should('have.length', 3);
    cy.window().then(win => new Cypress.Promise<void>((resolve, reject) => {
      const request = win.indexedDB.open('robot-learning-workbench-camera-v1'); request.onerror = () => reject(request.error);
      request.onsuccess = () => { const db = request.result, tx = db.transaction('videos'), get = tx.objectStore('videos').getAll();
        tx.oncomplete = () => { const group = get.result.find(row => row.views); expect(group.views).to.have.length(3); group.views.forEach(view => expect(view.video.size).to.be.greaterThan(0)); db.close(); resolve(); }; };
    }));
  });
  it('starts the preview directly and never opens a robot connection', () => {
    cy.intercept('POST', '/api/robot-transport/connect', req => { throw new Error('Preview must not connect hardware'); });
    openCameraPage(true);
    cy.contains('button', 'Start live preview').click();
    cy.contains('Live preview ready', { timeout: 120000 }).should('exist');
    cy.contains('Worker processing', { timeout: 30000 }).should('exist');
    cy.contains('[role="tab"]', 'Camera setup').click();
    cy.contains('Live processing ready').should('exist');
    cy.get('[aria-label="Camera count"]').should('be.disabled');
    cy.contains('button', 'Close cameras').filter(':visible').first().click();
    cy.get('[aria-label="Camera count"]').should('be.enabled');
  });
  it('compares both real detector workers on the same retained recording', () => {
    openCameraPage(true); setupTab();
    cy.get('[aria-label="Landmark detector"]').select('pose');
    cy.get('[aria-label="Processing mode"]').select('offline');
    cy.contains('button', 'Test all cameras').click();
    cy.contains('Camera ready to record', { timeout: 30000 }).should('exist');
    cy.contains('[role="tab"]', 'Live camera').click();
    cy.get('[aria-label="Countdown"]').select('1');
    cy.contains('button', 'Start recording').click();
    cy.contains('button', 'Stop recording', { timeout: 10000 }).should('exist'); cy.wait(1100);
    cy.contains('button', 'Stop recording').click();
    cy.contains('Recording saved on this device', { timeout: 20000 }).should('exist');
    cy.contains('button', 'Close cameras').filter(':visible').first().click();
    cy.contains('[role="tab"]', 'Recordings').click();
    cy.contains('summary', 'Compare landmark detectors').click();
    cy.contains('button', 'Compare detectors').should('be.enabled').click();
    cy.contains('button', 'Export comparison', { timeout: 120000 }).should('exist');
    cy.contains('td', 'MediaPipe Pose').should('exist');
    cy.contains('td', 'MediaPipe Holistic').should('exist');
  });
  it('opens, processes, connects and arms through one explicit Run action', () => {
    stubLandmarks(); openCameraPage(true);
    robotSettings(); cy.get('[aria-label="Robot connection"]').select('mock');
    cy.get('[aria-label="Robot motion profile"]').select('match-preview');
    cy.intercept('POST', '/api/robot-transport/connect').as('connectRobot');
    cy.intercept('POST', '/api/robot-transport/arm').as('armRobot');
    cy.contains('button', 'Run on mock robot').click();
    cy.contains('button', 'Stop robot', { timeout: 45000 }).should('be.enabled');
    cy.wait('@armRobot').its('response.body.armed').should('equal', true);
    cy.wait('@connectRobot').its('request.body').should('include', { max_joint_speed: 3, max_joint_acceleration: 10 });
    cy.request('/api/robot-transport/diagnostics').its('body').should(body => {
      expect(body.transport).to.equal('mock'); expect(body.samples.length).to.be.greaterThan(0);
      expect(body.samples[0]).to.have.property('packet'); expect(body.analysis).to.have.property('steady_samples');
    });
    cy.contains('button', 'Stop robot', { timeout: 15000 }).should('be.enabled').click();
    cy.contains('button', 'Close cameras').filter(':visible').should('exist');
    cy.contains('button', 'Disconnect robot').click();
    cy.contains('button', 'Run on mock robot').should('be.enabled');
    cy.contains('button', 'Close cameras').filter(':visible').first().click();
  });
});
