const $ = (id) => document.getElementById(id);
let live = false, running = false, starting = false, recording = false;
let generation = 0, captures = 0, recordStart = 0;
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function render() {
  document.body.classList.toggle('running', live);
  $('preview').hidden = running || starting;
  $('preview').textContent = live ? '■ Stop preview' : '▷ Start live preview';
  $('run').hidden = running || starting;
  $('stop').hidden = !running;
  $('cancel').hidden = !starting;
  $('save').disabled = !live || starting;
  $('record').disabled = !live || starting;
  $('preview').disabled = recording;
  $('run').textContent = $('transport').value === 'Mock robot' ? '↗ Run on mock robot' : '↗ Run on physical robot';
  for (const input of $('settings').querySelectorAll('input, select')) input.disabled = starting || running;
  $('camera-dot').classList.toggle('active', live);
  $('camera-status').textContent = live ? 'Camera live · processing' : 'Default camera';
  $('robot-status').textContent = `${running ? 'Following · ' : ''}${$('transport').value}`;
  $('tracking-badge').textContent = live ? '● TRACKING' : 'STANDBY';
  $('tracking-badge').classList.toggle('green', live);
  $('camera-hint').textContent = live ? 'Landmarks detected · simulated preview' : 'Start a session to preview movement';
  $('robot-hint').textContent = running ? 'Robot follows the reference · simulated' : 'Preview is the movement reference';
  $('mapping-summary').textContent = `${$('mapping').value} tracking`;
  if (!starting) {
    $('session-title').textContent = running ? 'Following your movement' : live ? 'Live preview is on' : 'Ready when you are';
    $('session-detail').textContent = running ? 'Simulated robot control is active. Stop robot keeps your preview open.' : live ? 'Explore your movement, save a pose, or start robot control.' : 'Your default camera and robot settings are ready.';
  }
}

async function startSession(withRobot) {
  if (starting) return;
  const attempt = ++generation;
  starting = true;
  render();
  const steps = live ? [] : ['Opening default camera…', 'Starting live processing…'];
  if (withRobot) steps.push(`Connecting ${$('transport').value}…`, 'Checking tracking and robot state…');
  for (const step of steps) {
    $('session-title').textContent = step;
    $('session-detail').textContent = 'Simulated startup · you can cancel at any time.';
    await sleep(650);
    if (attempt !== generation) return;
  }
  live = true;
  running = withRobot;
  starting = false;
  render();
}
$('preview').onclick = () => {
  if (live) { live = false; render(); }
  else void startSession(false);
};
$('run').onclick = () => void startSession(true);
$('stop').onclick = () => { running = false; render(); };
$('cancel').onclick = () => { generation++; starting = false; render(); };
$('settings-toggle').onclick = () => {
  $('settings').hidden = !$('settings').hidden;
  $('settings-toggle').setAttribute('aria-expanded', String(!$('settings').hidden));
};
$('transport').onchange = render;
$('mapping').onchange = render;
function saveCapture(kind, detail) {
  if (!captures) $('captures').replaceChildren();
  captures++;
  const row = document.createElement('div');
  row.className = 'capture-item';
  const name = document.createElement('strong');
  name.textContent = `${kind} ${String(captures).padStart(2, '0')}`;
  const meta = document.createElement('span');
  meta.textContent = `${$('mapping').value} · ${detail} · mock capture`;
  row.append(name, meta);
  $('captures').prepend(row);
  $('capture-count').textContent = captures;
  $('capture-detail').textContent = `${kind} saved in this draft. Your live session continues.`;
}
$('save').onclick = () => saveCapture('Pose', 'just now');
$('record').onclick = () => {
  recording = !recording;
  $('record').classList.toggle('danger', recording);
  $('record').textContent = recording ? '■ Stop recording' : '● Record gesture';
  if (recording) {
    recordStart = Date.now();
    $('capture-detail').textContent = 'Recording a simulated gesture… Stop recording when you are ready.';
  } else saveCapture('Gesture', `${((Date.now() - recordStart) / 1000).toFixed(1)} s`);
  render();
};
render();
