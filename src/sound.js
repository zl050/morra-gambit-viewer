// Chess move sound effects — Standard sfx set by Enigmahack, AGPLv3+
// Source: https://github.com/lichess-org/lila (public/sound/standard/)
let ctx = null;
const buffers = {};

function ensureCtx() {
  if (!ctx) {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  return ctx;
}

// Browsers create an AudioContext in the "suspended" state and only allow it to
// start from within a user gesture. Resume it on the first interaction so that
// every later sound plays reliably — including ones fired from a timer (e.g. the
// quiz's auto-reply) or the mouse wheel, which are not gesture contexts and so
// could never resume the context themselves. Without this, sound is intermittent.
function unlock() {
  const ac = ensureCtx();
  if (ac) ac.resume().catch(() => {});
  window.removeEventListener('pointerdown', unlock);
  window.removeEventListener('keydown', unlock);
}

async function loadBuffer(name) {
  const ac = ensureCtx();
  if (!ac) return;
  const resp = await fetch(`./sound/${name}.ogg`);
  const arr = await resp.arrayBuffer();
  buffers[name] = await ac.decodeAudioData(arr);
}

export function initSounds() {
  ensureCtx();
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
  return Promise.all([loadBuffer('Move'), loadBuffer('Capture')]).catch(() => {});
}

export function playMove(san) {
  const ac = ctx;
  const name = typeof san === 'string' && san.includes('x') ? 'Capture' : 'Move';
  const buf = buffers[name];
  if (!ac || !buf) return;
  // Safety net in case the context dropped back to suspended (tab blur, etc.).
  if (ac.state === 'suspended') ac.resume().catch(() => {});
  try {
    const src = ac.createBufferSource();
    src.buffer = buf;
    src.connect(ac.destination);
    src.start();
  } catch {
    // A transient AudioContext failure must not break board navigation.
  }
}
