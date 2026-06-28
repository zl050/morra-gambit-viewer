import { Chessground } from 'chessground';
import { Chess } from 'chess.js';
import 'chessground/assets/chessground.base.css';
import 'chessground/assets/chessground.cburnett.css';
import './style.css';
import './board-theme.css';
import './pieces-merida.css';
import { initSounds, playMove } from './sound.js';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const GENERAL_DESCRIPTION =
  'Get started by selecting a chapter or searching by PGN/FEN.';

// Maximum positionDistance for a non-exact match to be offered as the
// "closest similar position" — roughly "about one move away" (see
// positionDistance below).
const MAX_SIMILAR_DISTANCE = 6;

const QUIZ_DESCRIPTION = 'White to move: seize the initiative with precise attack!';

// In-memory "scratch" chapter created the first time a user plays a move on the
// home page (no real chapter open). It is never persisted and never shown in the
// chapter dropdown.
const SCRATCH_ID = '__scratch__';

// Board color theme constants (logic in initSettings()/applyBoardTheme() below).
// Declared up here so the top-level initSettings() call isn't in their TDZ.
const BOARD_THEME_KEY = 'smg:board-theme';
const BOARD_THEMES = ['blue', 'brown'];
const DEFAULT_BOARD_THEME = 'blue';

// "Display" menu settings persisted to localStorage.
const SETTING_KEYS = {
  appearance: 'smg:appearance',
  board: BOARD_THEME_KEY,
  pieces: 'smg:pieces',
};
const SETTING_VALUES = {
  appearance: ['light', 'dark'],
  board: BOARD_THEMES,
  pieces: ['cburnett', 'merida'],
};
const SETTING_DEFAULTS = {
  appearance: 'light',
  board: DEFAULT_BOARD_THEME,
  pieces: 'merida',
};

const els = {
  chapterSelect: document.querySelector('#chapter-select'),
  descriptionText: document.querySelector('#description-text'),
  board: document.querySelector('#board'),
  startLine: document.querySelector('#start-line'),
  prevMove: document.querySelector('#prev-move'),
  nextMove: document.querySelector('#next-move'),
  endLine: document.querySelector('#end-line'),
  tree: document.querySelector('#tree'),
  flipBoard: document.querySelector('#flip-board'),
  settingsToggle: document.querySelector('#settings-toggle'),
  settingsMenu: document.querySelector('#settings-menu'),
  toggleSearch: document.querySelector('#toggle-search'),
  searchRow: document.querySelector('#search-row'),
  searchInput: document.querySelector('#search-input'),
  searchGo: document.querySelector('#search-go'),
  searchStatus: document.querySelector('#search-status'),
  toggleExport: document.querySelector('#toggle-export'),
  exportRow: document.querySelector('#export-row'),
  exportText: document.querySelector('#export-text'),
  copyPgn: document.querySelector('#copy-pgn'),
  toggleChallenge: document.querySelector('#challenge-bot'),
  challengeRow: document.querySelector('#challenge-row'),
  quizMode: document.querySelector('#quiz-mode'),
  quizModeIcon: document.querySelector('#quiz-mode-icon'),
  quizExitIcon: document.querySelector('#quiz-exit-icon'),
  quizStatus: document.querySelector('#quiz-status'),
  treePanel: document.querySelector('#tree-panel'),
  notesAck: document.querySelector('#notes-ack'),
  notesBlock: document.querySelector('#notes-block'),
};

const state = {
  repertoire: null,
  chapter: null,
  nodesById: new Map(),
  selectedNodeId: null,
  fenIndex: new Map(),
  quizActive: false,
  // Counters for the current quiz session's summary, reset in startQuiz().
  quizCorrectCount: 0,
  quizRetryCount: 0,
  // Counter for unique ids of user-created (free-play) nodes.
  nodeSeq: 0,
  // The NOTES panel is emphasized only once, on the first home-page free-play move.
  notesEmphasized: false,
};

// `viewOnly` must stay false for the board's whole lifetime. Chessground binds
// the board's pointer listeners only at construction/redrawAll, and only when
// not viewOnly; ground.set() never rebinds them. A board created viewOnly could
// therefore never become interactive for quiz mode. Interactivity is gated
// instead via movable.color / draggable.enabled.
//
// Right-click annotations (drawable) are enabled here, at construction, so they
// work globally — while browsing and during quiz mode alike — since drawing is
// independent of movable/quiz state (and enabling at construction is what binds
// the contextmenu-suppression listener). Right-click a square for a circle;
// right-click-drag between squares for an arrow. defaultSnapToValidMove is off so
// an arrow can connect any two squares (no legality/geometry limit).
const ANNOTATION_BLUE = '#003088';
const ANNOTATION_RED = '#882020';

// chessground's eventBrush() always returns one of four fixed brush *slots*,
// chosen purely by modifier — the slot names happen to be colors but carry no
// color meaning to us. Alias them by modifier so the colors below read honestly:
// a plain right-click draws blue, any modifier draws red.
const SLOT_NONE = 'green'; // right-click, no modifier
const SLOT_SHIFT_CTRL = 'red'; // + Shift / Ctrl
const SLOT_ALT = 'blue'; // + Alt
const SLOT_SHIFT_CTRL_ALT = 'yellow'; // + Shift/Ctrl and Alt
const annotationBrushes = {
  [SLOT_NONE]: { key: 'g', color: ANNOTATION_BLUE, opacity: 1, lineWidth: 10 },
  [SLOT_SHIFT_CTRL]: { key: 'r', color: ANNOTATION_RED, opacity: 1, lineWidth: 10 },
  [SLOT_ALT]: { key: 'b', color: ANNOTATION_RED, opacity: 1, lineWidth: 10 },
  [SLOT_SHIFT_CTRL_ALT]: { key: 'y', color: ANNOTATION_RED, opacity: 1, lineWidth: 10 },
};
const ground = Chessground(els.board, {
  fen: START_FEN,
  orientation: 'white',
  coordinates: false,
  viewOnly: false,
  movable: { free: false, color: undefined },
  draggable: { enabled: false },
  drawable: {
    enabled: true,
    defaultSnapToValidMove: false,
    brushes: annotationBrushes,
  },
});

setupBoardResize();
initSettings();
init();

// A small grip in the board's bottom-right corner lets the user drag to resize
// the board within a modest range. It lives in `.board-frame` as a sibling of
// `#board`, not inside chessground's DOM (`redrawAll()` would wipe it).
//
// Chessground rounds the rendered board down to integer square sizes, so it's
// a few px smaller than `.board-frame` and the gap varies as the (fractional)
// frame width is dragged. Pinning the handle to the frame corner would make it
// jitter outside the board, so instead we reposition it onto the rendered
// board's actual corner after every redraw, coalesced to one per frame.
function setupBoardResize() {
  const frame = document.querySelector('.board-frame');
  const handle = document.querySelector('#board-resize');
  if (!frame || !handle) return;

  // Snap the handle onto the real (rounded) board's bottom-right corner. The
  // 22px handle is offset so its box overhangs that corner by 9px, exactly like
  // lichess's `right/bottom: -9px`, leaving the two slashes hugging the edge.
  const positionHandle = () => {
    const container = els.board.querySelector('cg-container');
    if (!container) return;
    const c = container.getBoundingClientRect();
    const f = frame.getBoundingClientRect();
    handle.style.right = 'auto';
    handle.style.bottom = 'auto';
    handle.style.left = `${Math.round(c.right - f.left) - 13}px`;
    handle.style.top = `${Math.round(c.bottom - f.top) - 13}px`;
  };

  let drag = null;
  let initialBoardSize = null;
  let pendingSize = null;
  let rafId = 0;

  const applyResize = () => {
    rafId = 0;
    if (pendingSize == null) return;
    frame.style.maxWidth = 'none';
    frame.style.width = `${pendingSize}px`;
    ground.redrawAll();
    positionHandle();
  };

  handle.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    if (initialBoardSize === null) {
      initialBoardSize = frame.getBoundingClientRect().width;
    }
    drag = {
      startX: event.clientX,
      startY: event.clientY,
      startSize: frame.getBoundingClientRect().width,
    };
    document.body.classList.add('resizing');
    handle.setPointerCapture(event.pointerId);
  });

  handle.addEventListener('pointermove', (event) => {
    if (!drag) return;
    const shell = frame.parentElement;
    const styles = getComputedStyle(shell.parentElement);
    const multiColumn = styles.gridTemplateColumns.split(' ').length > 1;
    const gap = parseFloat(styles.columnGap) || 0;
    // Largest size that still fits the layout cleanly: in the 3-column view the
    // board may fill its column and borrow the two inter-column gaps (without
    // covering the side panels), bounded by the locked viewport height; the
    // single-column view just fills the available width.
    const layoutMax = multiColumn
      ? Math.min(shell.clientHeight, shell.clientWidth + 2 * gap)
      : shell.clientWidth;
    // Keep the zoom modest and relative to the board's initial size: 0.75x–1.25x.
    // The displayed initial size is 1.1x the original baseline, so divide it back
    // out before applying the 0.75x–1.25x range to that original baseline.
    const baseSize = initialBoardSize / 1.1;
    const minSize = baseSize * 0.75;
    const maxSize = Math.min(baseSize * 1.25, layoutMax);
    const delta = Math.max(event.clientX - drag.startX, event.clientY - drag.startY);
    pendingSize = Math.max(minSize, Math.min(drag.startSize + delta, maxSize));
    // Coalesce to one redraw per frame so fast drags don't thrash redrawAll().
    if (!rafId) rafId = requestAnimationFrame(applyResize);
  });

  const endDrag = (event) => {
    if (!drag) return;
    drag = null;
    document.body.classList.remove('resizing');
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    applyResize(); // flush the final size
    if (handle.hasPointerCapture(event.pointerId)) {
      handle.releasePointerCapture(event.pointerId);
    }
  };
  handle.addEventListener('pointerup', endDrag);
  handle.addEventListener('pointercancel', endDrag);

  // Keep the handle glued to the board corner whenever the rendered board
  // changes size — the first render, every redraw during a drag, and any
  // responsive reflow all flow through this one observer. (cg-container may not
  // exist on the very first frame, so retry until chessground has built it.)
  const observeBoard = () => {
    const container = els.board.querySelector('cg-container');
    if (!container) {
      requestAnimationFrame(observeBoard);
      return;
    }
    positionHandle();
    if ('ResizeObserver' in window) {
      new ResizeObserver(positionHandle).observe(container);
    }
  };
  observeBoard();
}

// Settings menu — Appearance, Board, and Pieces. All three persist to
// localStorage (SETTING_KEYS) and apply a class on load:
//   Appearance → `appearance-dark` on <html> (dark color palette)
//   Board      → `theme-*` on <html> (board colors + brown nav/grip)
//   Pieces     → `pieces-merida` on #board (swaps the piece SVGs)
// The SETTING_* / BOARD_THEME_* constants are declared near the top of the file
// so this section's top-level call isn't in their TDZ.

// Reflect a setting row's chosen value: highlight the active option button and
// show the matching left icon.
function selectOption(setting, value) {
  const row = els.settingsMenu.querySelector(`.settings-row[data-setting="${setting}"]`);
  if (!row) return;
  row.dataset.value = value;
  for (const opt of row.querySelectorAll('.settings-opt')) {
    const active = opt.dataset.value === value;
    opt.classList.toggle('is-active', active);
    opt.setAttribute('aria-checked', String(active));
  }
  for (const icon of row.querySelectorAll('.settings-row-icon .ic')) {
    icon.classList.toggle('is-shown', icon.dataset.value === value);
  }
}

// Apply a board theme: flip the `theme-*` class on <html>, then reflect it in the menu.
function applyBoardTheme(theme) {
  const root = document.documentElement;
  for (const name of BOARD_THEMES) {
    root.classList.toggle(`theme-${name}`, name === theme);
  }
  selectOption('board', theme);
}

// Apply the appearance (light/dark): toggle `appearance-dark` on <html>.
function applyAppearance(value) {
  document.documentElement.classList.toggle('appearance-dark', value === 'dark');
  selectOption('appearance', value);
}

// Apply a piece set: toggle `pieces-merida` on #board to swap piece images.
function applyPieces(value) {
  els.board.classList.toggle('pieces-merida', value === 'merida');
  selectOption('pieces', value);
}

// Read a persisted setting value, or its default if unset/invalid.
function readSetting(setting) {
  try {
    const saved = localStorage.getItem(SETTING_KEYS[setting]);
    if (SETTING_VALUES[setting].includes(saved)) return saved;
  } catch {
    // localStorage may be unavailable (e.g. private mode); fall back to default.
  }
  return SETTING_DEFAULTS[setting];
}

// Apply a setting: Board re-themes the page; appearance toggles dark mode; pieces swaps piece images.
function applySetting(setting, value) {
  if (setting === 'board') applyBoardTheme(value);
  else if (setting === 'appearance') applyAppearance(value);
  else if (setting === 'pieces') applyPieces(value);
  else selectOption(setting, value);
}

function initSettings() {
  // Restore every setting from localStorage (or its default) and apply it.
  for (const setting of Object.keys(SETTING_KEYS)) {
    applySetting(setting, readSetting(setting));
  }

  // Option clicks: apply and persist the chosen value for any setting.
  els.settingsMenu.addEventListener('click', (event) => {
    const opt = event.target.closest('.settings-opt');
    if (!opt) return;
    const setting = opt.closest('.settings-row').dataset.setting;
    const value = opt.dataset.value;
    applySetting(setting, value);
    try {
      localStorage.setItem(SETTING_KEYS[setting], value);
    } catch {
      // Persistence is best-effort; the in-page switch still works without it.
    }
  });

  // Open / close the dropdown.
  const closeMenu = () => {
    els.settingsMenu.hidden = true;
    els.settingsToggle.setAttribute('aria-expanded', 'false');
  };
  els.settingsToggle.addEventListener('click', (event) => {
    event.stopPropagation();
    const willOpen = els.settingsMenu.hidden;
    els.settingsMenu.hidden = !willOpen;
    els.settingsToggle.setAttribute('aria-expanded', String(willOpen));
  });
  document.addEventListener('click', (event) => {
    if (els.settingsMenu.hidden) return;
    if (!els.settingsToggle.contains(event.target) && !els.settingsMenu.contains(event.target)) {
      closeMenu();
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !els.settingsMenu.hidden) {
      closeMenu();
      els.settingsToggle.focus();
    }
  });
}

async function init() {
  setDescription(GENERAL_DESCRIPTION);
  initSounds();

  try {
    const response = await fetch('./data/repertoire.json', { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Could not load repertoire.json (${response.status})`);
    }

    state.repertoire = await response.json();
    state.fenIndex = buildFenIndex(state.repertoire);
    renderChapterOptions();
    restoreFromHash();
    if (!state.chapter) {
      applyFreePlay(START_FEN);
      updateNavigationState();
    }
  } catch (error) {
    showLoadError(error);
  }

  els.chapterSelect.addEventListener('change', () => {
    if (state.quizActive) return;
    const chapterId = els.chapterSelect.value;
    if (chapterId) {
      selectChapter(chapterId);
    } else {
      clearSelection();
    }
  });
  els.startLine.addEventListener('click', selectStart);
  els.prevMove.addEventListener('click', selectPrevious);
  els.nextMove.addEventListener('click', selectNext);
  els.endLine.addEventListener('click', selectEnd);
  els.flipBoard.addEventListener('click', () => ground.toggleOrientation());
  els.toggleSearch.addEventListener('click', () => toggleToolRow(els.searchRow, els.toggleSearch));
  els.searchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      runPositionSearch(els.searchInput.value);
    }
  });
  els.searchGo.addEventListener('click', () => runPositionSearch(els.searchInput.value));
  els.toggleExport.addEventListener('click', () => {
    const open = toggleToolRow(els.exportRow, els.toggleExport);
    if (open) refreshExportPgn();
  });
  els.copyPgn.addEventListener('click', copyExportPgn);
  els.toggleChallenge.addEventListener('click', () => toggleToolRow(els.challengeRow, els.toggleChallenge));
  els.quizMode.addEventListener('click', () => {
    if (state.quizActive) {
      endQuiz();
    } else {
      startQuiz();
    }
  });
  els.board.addEventListener(
    'wheel',
    (event) => {
      if (!state.chapter || state.quizActive) return;
      event.preventDefault();
      if (event.deltaY < 0) selectPrevious();
      if (event.deltaY > 0) selectNext();
    },
    { passive: false },
  );
  window.addEventListener('keydown', (event) => {
    if (state.quizActive) return;
    if (event.key === 'ArrowLeft') selectPrevious();
    if (event.key === 'ArrowRight') selectNext();
  });
  window.addEventListener('hashchange', restoreFromHash);
}

const CHAPTER_GROUP_BOUNDARIES = [
  { beforeId: 'ch1', label: 'Accepted' },
  { beforeId: 'ch12', label: 'Declined' },
];

function renderChapterOptions() {
  let target = els.chapterSelect;
  for (const chapter of state.repertoire.chapters) {
    const boundary = CHAPTER_GROUP_BOUNDARIES.find((item) => item.beforeId === chapter.id);
    if (boundary) {
      target = document.createElement('optgroup');
      target.label = boundary.label;
      els.chapterSelect.append(target);
    }
    const option = document.createElement('option');
    option.value = chapter.id;
    option.textContent = chapter.title;
    target.append(option);
  }
}

function selectChapter(chapterId, preferredNodeId = null, updateHash = true) {
  const chapter = state.repertoire.chapters.find((item) => item.id === chapterId);
  if (!chapter) return;

  state.chapter = chapter;
  els.notesBlock?.classList.remove('is-emphasized', 'is-highlighted');
  // Clone nodes into a working copy so free-play edits never mutate the shared
  // repertoire data (also backing fenIndex/search) and are discarded on switch.
  state.nodesById = new Map(
    chapter.nodes.map((node) => [node.id, { ...node, children: [...node.children] }]),
  );
  state.nodeSeq = 0;
  els.chapterSelect.value = chapter.id;

  const rootId = getRootNode().id;
  const defaultNodeId = preferredNodeId && state.nodesById.has(preferredNodeId) ? preferredNodeId : getOpeningEntryNodeId(rootId);
  selectNode(defaultNodeId, updateHash);
  renderTree();
}

// Opening a chapter jumps past its forced, branch-free trunk rather than
// landing on the bare start position. Accepted-line chapters (1-4, 6-9) share
// an identical trunk through 4. Nxc3 (the default below); chapter 3 also
// shares its own further trunk (through 8...a6, covered by chapters 2 and 9),
// hence its override. Declined/sideline chapters (12, 13) reach a different
// move at the same ply, so this falls back to the chapter root for them.
const OPENING_ENTRY_OVERRIDES = {
  ch3: { ply: 16, san: 'a6' },
};
const DEFAULT_OPENING_ENTRY = { ply: 7, san: 'Nxc3' };

function getOpeningEntryNodeId(rootId) {
  const target = OPENING_ENTRY_OVERRIDES[state.chapter.id] || DEFAULT_OPENING_ENTRY;
  let node = state.nodesById.get(rootId);
  for (let i = 0; i < target.ply && node.children.length > 0; i++) {
    node = mainlineChild(node);
    if (!node) return rootId;
  }
  return node && node.san === target.san && node.ply === target.ply ? node.id : rootId;
}

function clearSelection() {
  state.chapter = null;
  state.nodesById = new Map();
  state.selectedNodeId = null;
  ground.set({ fen: START_FEN, lastMove: undefined, ...freePlayBoardConfig(START_FEN) });
  setDescription(GENERAL_DESCRIPTION);
  els.tree.textContent = '';
  updateNavigationState();
  if (!els.exportRow.hidden) refreshExportPgn();
  replaceHash('');
}

function selectNode(nodeId, updateHash = true) {
  if (!state.chapter || !state.nodesById.has(nodeId)) return;

  state.selectedNodeId = nodeId;
  const node = getSelectedNode();
  const description = node.description || state.chapter.description || GENERAL_DESCRIPTION;

  ground.set({
    fen: node.fen,
    lastMove: getLastMove(node),
    ...(state.quizActive ? {} : freePlayBoardConfig(node.fen)),
  });
  setDescription(description);
  renderTree();
  updateNavigationState();
  if (!els.exportRow.hidden) refreshExportPgn();

  // Ephemeral nodes (user moves / scratch chapter) aren't persisted, so keep
  // them out of the shareable URL.
  if (updateHash && !node.isUser && state.chapter.id !== SCRATCH_ID) {
    replaceHash(`${state.chapter.id}/${node.id}`);
  }
}

function renderTree() {
  els.tree.textContent = '';

  if (!state.chapter) return;

  const root = getRootNode();

  if (root.children.length === 0) {
    els.tree.textContent = 'This chapter has no moves.';
    return;
  }

  // The opening "trunk" (the forced sequence before the first branch) is shown
  // as a clean numbered table; branching begins at its final node.
  const trunk = getTrunk(root);
  const branchPoint = trunk.length > 0 ? trunk[trunk.length - 1] : root;

  if (trunk.length > 0) {
    els.tree.append(renderTrunkTable(trunk));
  }

  const flow = document.createElement('div');
  flow.className = 'notation-flow';
  renderMovesFrom(branchPoint, flow, true);
  if (flow.childNodes.length > 0) {
    els.tree.append(flow);
  }

  els.tree.querySelector('.selected')?.scrollIntoView({ block: 'nearest' });
}

function getTrunk(root) {
  const trunk = [];
  let node = mainlineChild(root);
  while (node) {
    trunk.push(node);
    if (node.children.length !== 1) break;
    node = mainlineChild(node);
  }
  return trunk;
}

function renderTrunkTable(trunk) {
  const table = document.createElement('div');
  table.className = 'notation-table';

  for (const row of groupMovesByNumber(trunk)) {
    const moveNumber = document.createElement('div');
    moveNumber.className = 'notation-number';
    moveNumber.textContent = row.number;
    table.append(moveNumber);

    table.append(renderNotationCell(row.white));
    table.append(renderNotationCell(row.black));
  }

  return table;
}

function renderNotationCell(node) {
  const cell = document.createElement('div');
  cell.className = 'notation-cell';

  if (!node) return cell;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = `notation-move${node.id === state.selectedNodeId ? ' selected' : ''}`;
  button.textContent = node.san + (node.sanSuffix || '');
  button.addEventListener('click', () => { playMove(node.san); selectNode(node.id); });
  cell.append(button);
  return cell;
}

// Render every move from `position` onward as flowing notation: the main line
// stays inline, while each alternative becomes a nested, boxed side line.
function renderMovesFrom(position, container, forceNumber) {
  let node = position;
  let force = forceNumber;

  while (true) {
    const children = node.children.map((id) => state.nodesById.get(id));
    if (children.length === 0) return;

    const main = children.find((child) => child.isMainline) || children[0];
    const variations = children.filter((child) => child !== main);

    container.append(renderInlineMove(main, force));
    for (const variation of variations) {
      container.append(renderVariationBox(variation));
    }

    // After a side line interrupts the flow, restate the main move's number.
    force = variations.length > 0;
    node = main;
  }
}

function renderVariationBox(variation) {
  const box = document.createElement('div');
  box.className = 'variation-box';
  box.append(renderInlineMove(variation, true));
  renderMovesFrom(variation, box, false);
  return box;
}

function renderInlineMove(node, forceNumber) {
  const button = document.createElement('button');
  button.type = 'button';
  const role = node.isMainline ? 'mainline' : 'sideline';
  const selected = node.id === state.selectedNodeId ? ' selected' : '';
  button.className = `notation-move-inline ${role}${selected}`;
  button.textContent = inlineLabel(node, forceNumber);
  button.addEventListener('click', () => { playMove(node.san); selectNode(node.id); });
  return button;
}

function inlineLabel(node, forceNumber) {
  const san = node.san + (node.sanSuffix || '');
  const moveNumber = Math.ceil(node.ply / 2);
  if (node.ply % 2 === 1) {
    return `${moveNumber}.${san}`;
  }
  return forceNumber ? `${moveNumber}...${san}` : san;
}

function mainlineChild(node) {
  const children = node.children.map((id) => state.nodesById.get(id));
  return children.find((child) => child.isMainline) || children[0] || null;
}

function selectStart() {
  if (state.quizActive) return;
  if (!state.chapter) return;
  selectNode(getRootNode().id);
}

function selectPrevious() {
  if (state.quizActive) return;
  if (!state.chapter) return;
  const node = getSelectedNode();
  if (node.parentId) {
    selectNode(node.parentId);
  }
}

function selectNext() {
  if (state.quizActive) return;
  if (!state.chapter) return;
  const next = mainlineChild(getSelectedNode());
  if (next) {
    playMove(next.san);
    selectNode(next.id);
  }
}

function selectEnd() {
  if (state.quizActive) return;
  if (!state.chapter) return;

  let node = getSelectedNode();
  while (node.children.length > 0) {
    node = mainlineChild(node);
  }
  if (node.id !== state.selectedNodeId) playMove(node.san);
  selectNode(node.id);
}

function updateNavigationState() {
  if (!state.chapter) {
    els.startLine.disabled = true;
    els.prevMove.disabled = true;
    els.nextMove.disabled = true;
    els.endLine.disabled = true;
    return;
  }

  const node = getSelectedNode();
  els.startLine.disabled = !node.parentId;
  els.prevMove.disabled = !node.parentId;
  els.nextMove.disabled = node.children.length === 0;
  els.endLine.disabled = node.children.length === 0;
}

function restoreFromHash() {
  if (state.quizActive) return;
  if (!state.repertoire) return;

  const hash = window.location.hash.replace(/^#/, '');
  if (!hash) return;

  const [chapterId, nodeId] = hash.split('/');
  if (chapterId) {
    selectChapter(chapterId, nodeId, false);
  }
}

function getRootNode() {
  for (const node of state.nodesById.values()) {
    if (node.parentId === null) return node;
  }
  return undefined;
}

function getSelectedNode() {
  return state.nodesById.get(state.selectedNodeId) || getRootNode();
}

function getSelectedPath() {
  const path = [];
  let node = getSelectedNode();

  while (node) {
    path.unshift(node);
    node = node.parentId ? state.nodesById.get(node.parentId) : null;
  }

  return path;
}

function groupMovesByNumber(path) {
  const rowsByNumber = new Map();
  for (const node of path) {
    const number = Math.ceil(node.ply / 2);
    if (!rowsByNumber.has(number)) {
      rowsByNumber.set(number, { number: String(number), white: null, black: null });
    }

    const row = rowsByNumber.get(number);
    if (node.ply % 2 === 1) {
      row.white = node;
    } else {
      row.black = node;
    }
  }

  return Array.from(rowsByNumber.values());
}

function getLastMove(node) {
  if (!node.uci || node.uci.length < 4) return undefined;
  return [node.uci.slice(0, 2), node.uci.slice(2, 4)];
}

function toggleToolRow(row, button) {
  row.hidden = !row.hidden;
  button.setAttribute('aria-expanded', String(!row.hidden));
  return !row.hidden;
}

// Build a chessground `dests` map (from-square -> legal to-squares) for the
// position `fen`, via chess.js's verbose move list. Dedupe promotion entries.
function computeDests(fen) {
  const chess = new Chess(fen);
  const dests = new Map();
  for (const move of chess.moves({ verbose: true })) {
    const tos = dests.get(move.from) || [];
    if (!tos.includes(move.to)) tos.push(move.to);
    dests.set(move.from, tos);
  }
  return dests;
}

// chessground's `turnColor` is never derived from `fen` by ground.set(), so it
// must be set explicitly whenever the position changes.
function turnColorOf(fen) {
  return fen.split(' ')[1] === 'w' ? 'white' : 'black';
}

function pluralize(count, singular, plural) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function quizSummaryMessage() {
  return `Quiz complete · ${pluralize(state.quizCorrectCount, 'move', 'moves')} · ${pluralize(state.quizRetryCount, 'retry', 'retries')}`;
}

function setQuizStatus(message, kind) {
  els.quizStatus.textContent = message;
  els.quizStatus.dataset.kind = kind;
  els.quizStatus.hidden = false;
}

// Render rich quiz feedback into the single #quiz-status box. `parts` is an
// array whose items are either strings (text; '\n' becomes a <br>) or
// { button, onClick } descriptors rendered as inline buttons. Building DOM
// (rather than innerHTML) keeps SAN text safe and lets the alternative-move
// buttons carry click handlers.
function setQuizStatusContent(parts, kind) {
  els.quizStatus.replaceChildren();
  els.quizStatus.dataset.kind = kind;
  for (const part of parts) {
    if (typeof part === 'string') {
      const lines = part.split('\n');
      lines.forEach((line, i) => {
        if (i > 0) els.quizStatus.appendChild(document.createElement('br'));
        if (line) els.quizStatus.appendChild(document.createTextNode(line));
      });
    } else if (part && part.button) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'quiz-alt-btn';
      btn.textContent = part.button;
      btn.addEventListener('click', part.onClick);
      els.quizStatus.appendChild(btn);
    }
  }
  els.quizStatus.hidden = false;
}

function clearQuizStatus() {
  els.quizStatus.hidden = true;
  els.quizStatus.textContent = '';
  delete els.quizStatus.dataset.kind;
}

// A White candidate flagged ?! is an inferior ("second-best") move: it is a real
// child node but is treated as a wrong answer in the quiz.
function isDubious(node) {
  return (node.sanSuffix || '').includes('?!');
}

// Acceptable White replies at a White-to-move node: children NOT flagged ?!.
function acceptableWhiteChildren(node) {
  return node.children
    .map((id) => state.nodesById.get(id))
    .filter((child) => !isDubious(child));
}

function sanLabel(node) {
  return node.san + (node.sanSuffix || '');
}

function startQuiz() {
  if (!state.chapter || state.chapter.id === SCRATCH_ID) {
    setQuizStatus('Select a chapter first.', 'error');
    return;
  }

  const startNode = getSelectedNode();
  if (startNode.children.length === 0) {
    setQuizStatus('This is the end of the chapter — there are no more moves to quiz.', 'error');
    return;
  }

  let currentNode = startNode;
  let blackOpening = false;
  if (turnColorOf(startNode.fen) === 'black') {
    // Black's opening reply uses the mainline (same rule as auto-replies during
    // the quiz, see presentBlackReply), not a random pick.
    const blackReply = mainlineChild(startNode);
    if (!blackReply || blackReply.children.length === 0) {
      setQuizStatus('This is the end of the chapter — there are no more moves to quiz.', 'error');
      return;
    }
    currentNode = blackReply;
    blackOpening = true;
  }

  if (!els.searchRow.hidden) toggleToolRow(els.searchRow, els.toggleSearch);
  if (!els.exportRow.hidden) toggleToolRow(els.exportRow, els.toggleExport);
  if (!els.challengeRow.hidden) toggleToolRow(els.challengeRow, els.toggleChallenge);

  state.quizActive = true;
  state.selectedNodeId = currentNode.id;
  state.quizCorrectCount = 0;
  state.quizRetryCount = 0;

  ground.set({
    fen: currentNode.fen,
    orientation: 'white',
    turnColor: turnColorOf(currentNode.fen),
    lastMove: getLastMove(currentNode),
    movable: {
      free: false,
      color: 'white',
      dests: computeDests(currentNode.fen),
      showDests: false,
      events: { after: onUserMove },
    },
    draggable: { enabled: true },
    selectable: { enabled: true },
  });

  if (blackOpening) {
    // Quiz starts on Black's move: Black has already played its mainline reply,
    // and its sibling replies are offered as buttons just like mid-quiz.
    renderOpeningBlackStatus(startNode, currentNode);
  } else {
    setQuizStatus(QUIZ_DESCRIPTION, 'info');
  }

  els.treePanel.hidden = true;

  els.chapterSelect.disabled = true;
  els.startLine.disabled = true;
  els.prevMove.disabled = true;
  els.nextMove.disabled = true;
  els.endLine.disabled = true;
  els.flipBoard.disabled = true;
  els.toggleSearch.disabled = true;

  els.quizMode.querySelector('.tool-label').textContent = 'Quit quiz mode';
  els.quizMode.setAttribute('aria-expanded', 'true');
  els.quizMode.setAttribute('aria-label', 'Quit quiz mode');
  els.quizMode.title = 'Quit quiz mode';
  els.quizModeIcon.style.display = 'none';
  els.quizExitIcon.hidden = false;

  els.quizMode.classList.add('is-emphasized', 'is-quiz-active');
  setTimeout(() => els.quizMode.classList.remove('is-emphasized'), 500);
}

function endQuiz(message, kind) {
  state.quizActive = false;

  ground.set({
    movable: {
      free: false,
      color: undefined,
      dests: undefined,
      showDests: true,
      events: { after: undefined },
    },
    draggable: { enabled: false },
    selectable: { enabled: true },
  });

  els.treePanel.hidden = false;

  els.chapterSelect.disabled = false;
  els.flipBoard.disabled = false;
  els.toggleSearch.disabled = false;

  els.quizMode.querySelector('.tool-label').textContent = 'Quiz mode';
  els.quizMode.setAttribute('aria-expanded', 'false');
  els.quizMode.setAttribute('aria-label', "Quiz mode — practice White's moves from here");
  els.quizMode.title = "Quiz mode — practice White's moves from here";
  els.quizModeIcon.style.display = '';
  els.quizExitIcon.hidden = true;
  els.quizMode.classList.remove('is-emphasized', 'is-quiz-active');

  // Resyncs description, tree, hash, and nav-button disabled state.
  selectNode(state.selectedNodeId, true);

  if (message) {
    setQuizStatus(message, kind);
  } else {
    clearQuizStatus();
  }
}

// Chessground config that makes the board playable for free (legal moves only,
// either color, no destination dots) at the position `fen`. Used everywhere a
// browsable position is shown — outside quiz mode.
function freePlayBoardConfig(fen) {
  return {
    turnColor: turnColorOf(fen),
    movable: {
      free: false,
      color: turnColorOf(fen),
      dests: computeDests(fen),
      showDests: false,
      events: { after: onFreeMove },
    },
    draggable: { enabled: true },
    selectable: { enabled: true },
  };
}

// Apply free-play interactivity at `fen` without changing the displayed position
// (used for the initial home board, where the FEN is already set).
function applyFreePlay(fen) {
  ground.set(freePlayBoardConfig(fen));
}

// Create the in-memory scratch chapter for home-page free play. Sets it as the
// current chapter so the notation area and free play reuse the chapter machinery.
function startScratchChapter() {
  const root = {
    id: 'scratch-root',
    parentId: null,
    san: null,
    uci: null,
    ply: 0,
    fen: START_FEN,
    children: [],
    isMainline: true,
  };
  state.chapter = { id: SCRATCH_ID, title: 'Free play', description: null, nodes: [root] };
  state.nodesById = new Map([[root.id, root]]);
  state.selectedNodeId = root.id;
  state.nodeSeq = 0;
}

// Briefly highlight the NOTES panel, once per session, to point the user at the
// notation that just started recording their moves.
function emphasizeNotesOnce() {
  if (state.notesEmphasized) return;
  state.notesEmphasized = true;
  const panel = els.notesBlock;
  if (!panel) return;
  // is-highlighted: persistent ring, removed when a chapter is selected.
  // is-emphasized: one-shot pulse animation, removed after the duration elapses.
  panel.classList.add('is-highlighted', 'is-emphasized');
  setTimeout(() => panel.classList.remove('is-emphasized'), 1400);
}

// Handle a user move while browsing (free play). Walks into an existing child if
// the move already has one; otherwise appends a new side-line node.
function onFreeMove(orig, dest) {
  if (state.quizActive) return;

  const isHomeFirstMove = !state.chapter;
  const beforeFen = state.chapter ? getSelectedNode().fen : START_FEN;
  const chess = new Chess(beforeFen);

  let result;
  try {
    result = chess.move({ from: orig, to: dest, promotion: 'q' });
  } catch {
    ground.set({
      fen: beforeFen,
      turnColor: turnColorOf(beforeFen),
      lastMove: state.chapter ? getLastMove(getSelectedNode()) : undefined,
      movable: { dests: computeDests(beforeFen) },
    });
    return;
  }

  if (isHomeFirstMove) startScratchChapter();
  const before = getSelectedNode();

  // If a child already reaches this position, walk into it (book or prior move).
  const existing = before.children
    .map((id) => state.nodesById.get(id))
    .find((child) => fenKey(child.fen) === fenKey(chess.fen()));
  if (existing) {
    playMove(existing.san);
    selectNode(existing.id);
    return;
  }

  const node = {
    id: `u${state.nodeSeq++}`,
    parentId: before.id,
    san: result.san,
    uci: orig + dest + (result.promotion || ''),
    ply: before.ply + 1,
    fen: chess.fen(),
    children: [],
    isMainline: false,
    isUser: true,
  };
  state.nodesById.set(node.id, node);
  before.children.push(node.id);
  playMove(node.san);
  selectNode(node.id);

  if (isHomeFirstMove) emphasizeNotesOnce();
}

function onUserMove(orig, dest) {
  if (!state.quizActive) return;

  const before = getSelectedNode();
  const chess = new Chess(before.fen);

  let result;
  try {
    result = chess.move({ from: orig, to: dest, promotion: 'q' });
  } catch {
    state.quizRetryCount += 1;
    ground.set({
      fen: before.fen,
      turnColor: turnColorOf(before.fen),
      lastMove: getLastMove(before),
      movable: { dests: computeDests(before.fen) },
    });
    setQuizStatus("That move isn't legal here.", 'error');
    return;
  }

  // The user's move is correct if it matches any *acceptable* White child
  const acceptable = acceptableWhiteChildren(before);
  const playedKey = fenKey(chess.fen());
  const whiteNode = acceptable.find((child) => fenKey(child.fen) === playedKey);

  if (!whiteNode) {
    state.quizRetryCount += 1;
    ground.set({
      fen: chess.fen(),
      turnColor: turnColorOf(chess.fen()),
      lastMove: [orig, dest],
      movable: { dests: new Map() },
    });
    setQuizStatus(`${result.san} is not the repertoire move here. Try again.`, 'error');

    setTimeout(() => {
      if (!state.quizActive) return;
      ground.set({
        fen: before.fen,
        turnColor: turnColorOf(before.fen),
        lastMove: getLastMove(before),
        movable: { dests: computeDests(before.fen) },
      });
    }, 500);
    return;
  }

  // Correct move. Continue along the hit node (not forced to the mainline).
  state.quizCorrectCount += 1;
  playMove(whiteNode.san);
  state.selectedNodeId = whiteNode.id;
  ground.set({
    fen: whiteNode.fen,
    turnColor: turnColorOf(whiteNode.fen),
    lastMove: getLastMove(whiteNode),
    movable: { dests: new Map() },
  });

  // Surface the other acceptable White moves as "Also playable".
  const whiteAlts = acceptable.filter((child) => child.id !== whiteNode.id);
  const whiteLine = whiteAlts.length
    ? `Correct! Also playable: ${whiteAlts.map(sanLabel).join(', ')}`
    : 'Correct!';
  setQuizStatus(whiteLine, 'success');

  // Termination "last move is White": the hit node has no reply to play, so the
  // line ends here without a Black move. (The other termination, "last move is
  // Black", is handled inside presentBlackReply)
  const blackNode = mainlineChild(whiteNode);
  if (!blackNode) {
    endQuiz(quizSummaryMessage(), 'success');
    return;
  }

  setTimeout(() => {
    if (!state.quizActive) return;
    presentBlackReply(whiteNode, blackNode, whiteLine);
  }, 350);
}

// Play Black's reply `blackNode` (a child of `whiteNode`) on the board and show
// the combined feedback. Black auto-replies with the mainline, and
// any sibling replies are offered as buttons that swap in that reply.
function presentBlackReply(whiteNode, blackNode, whiteLine) {
  playMove(blackNode.san);
  state.selectedNodeId = blackNode.id;

  const terminal = blackNode.children.length === 0;
  ground.set({
    fen: blackNode.fen,
    turnColor: turnColorOf(blackNode.fen),
    lastMove: getLastMove(blackNode),
    movable: { dests: terminal ? new Map() : computeDests(blackNode.fen) },
  });

  // The mainline Black reply ends the line — it has been played on the
  // board above, now finish with the summary.
  if (terminal) {
    endQuiz(quizSummaryMessage(), 'success');
    return;
  }

  // Black's other replies (relative to the one just played). Clicking one swaps
  // it in; it does not count as a quizzed move.
  const blackAlts = whiteNode.children
    .map((id) => state.nodesById.get(id))
    .filter((child) => child.id !== blackNode.id);

  const parts = [`${whiteLine}\nBlack played ${sanLabel(blackNode)}.`];
  if (blackAlts.length) {
    parts.push('\nBlack could also play: ');
    blackAlts.forEach((alt) => {
      parts.push({
        button: sanLabel(alt),
        onClick: () => {
          if (!state.quizActive) return;
          // Undo the displayed reply and play the chosen alternative instead by
          // re-presenting from `whiteNode`; afterwards it is White to move again
          // (or the line ends if the alternative is terminal).
          presentBlackReply(whiteNode, alt, whiteLine);
        },
      });
    });
  }
  setQuizStatusContent(parts, 'success');
}

// Opening feedback when the quiz starts on Black's move: "Black played X. Find
// White's best move." plus buttons for Black's sibling replies. The board for
// `blackNode` is set up by the caller (startQuiz) or swapOpeningBlackReply.
function renderOpeningBlackStatus(startNode, blackNode) {
  const blackAlts = startNode.children
    .map((id) => state.nodesById.get(id))
    .filter((child) => child.id !== blackNode.id);

  const parts = [`Black played ${sanLabel(blackNode)}. Find White's best move.`];
  if (blackAlts.length) {
    parts.push('\nBlack could also play: ');
    blackAlts.forEach((alt) => {
      parts.push({
        button: sanLabel(alt),
        onClick: () => swapOpeningBlackReply(startNode, alt),
      });
    });
  }
  setQuizStatusContent(parts, 'info');
}

// Swap the opening Black reply for `alt` (a sibling of the displayed reply).
// Stays in quiz mode and does not count as a quizzed move; afterwards it is
// still White to move (or the line ends if the alternative is terminal).
function swapOpeningBlackReply(startNode, alt) {
  if (!state.quizActive) return;
  playMove(alt.san);
  state.selectedNodeId = alt.id;

  const terminal = alt.children.length === 0;
  ground.set({
    fen: alt.fen,
    turnColor: turnColorOf(alt.fen),
    lastMove: getLastMove(alt),
    movable: { dests: terminal ? new Map() : computeDests(alt.fen) },
  });

  if (terminal) {
    endQuiz(quizSummaryMessage(), 'success');
    return;
  }
  renderOpeningBlackStatus(startNode, alt);
}

// Build an index from a normalized position key to every chapter node that
// reaches that position, so a searched PGN/FEN can be matched regardless of
// which chapter (or how many chapters) reach it.
function buildFenIndex(repertoire) {
  const index = new Map();
  for (const chapter of repertoire.chapters) {
    for (const node of chapter.nodes) {
      const key = fenKey(node.fen);
      if (!index.has(key)) index.set(key, []);
      index.get(key).push({ chapterId: chapter.id, nodeId: node.id });
    }
  }
  return index;
}

// Normalize a FEN to its position-identifying fields: piece placement, side
// to move, castling rights, and en-passant target square.
//
// The en-passant field is re-derived rather than trusted, because different
// chess libraries disagree about it: python-chess (used to export the
// repertoire) writes the target square only when a legal en-passant capture
// actually exists, while chess.js (used to parse searched PGN/FEN) writes it
// after any double pawn push. Without this, the same position can produce two
// different keys and a real match is missed. We keep the square only when a
// pawn of the side to move can legally capture onto it.
function fenKey(fen) {
  const [placement, turn, castle, ep] = fen.trim().split(/\s+/);
  return [placement, turn, castle, normalizeEpSquare(placement, turn, ep)].join(' ');
}

function normalizeEpSquare(placement, turn, ep) {
  if (!ep || ep === '-') return '-';
  const squares = expandPlacement(placement);
  const file = ep.charCodeAt(0) - 97; // 'a'..'h' -> 0..7
  const epRank = Number(ep[1]); // 6 (white to capture) or 3 (black to capture)
  const pawnChar = turn === 'w' ? 'P' : 'p';
  const pawnRank = turn === 'w' ? epRank - 1 : epRank + 1;
  const at = (rank, f) => squares[(8 - rank) * 8 + f]; // expandPlacement is a8..h1
  for (const df of [-1, 1]) {
    const f = file + df;
    if (f >= 0 && f <= 7 && at(pawnRank, f) === pawnChar) return ep;
  }
  return '-';
}

// Expand a FEN piece-placement field (e.g. "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR")
// into a 64-element array of single characters, using '.' for empty squares.
function expandPlacement(placement) {
  const squares = [];
  for (const ch of placement) {
    if (ch === '/') continue;
    if (ch >= '1' && ch <= '8') {
      squares.push(...Array(Number(ch)).fill('.'));
    } else {
      squares.push(ch);
    }
  }
  return squares;
}

// Distance between two fenKey strings: board Hamming distance plus small
// penalties for side-to-move, castling-rights, and en-passant differences.
// Lower = more similar. Only meaningful as a relative ranking, not an exact
// "moves away" count.
function positionDistance(keyA, keyB) {
  const [placementA, turnA, castleA, epA] = keyA.split(' ');
  const [placementB, turnB, castleB, epB] = keyB.split(' ');

  const squaresA = expandPlacement(placementA);
  const squaresB = expandPlacement(placementB);
  let distance = 0;
  for (let i = 0; i < 64; i++) {
    if (squaresA[i] !== squaresB[i]) distance++;
  }

  if (turnA !== turnB) distance += 2;

  for (const flag of 'KQkq') {
    if (castleA.includes(flag) !== castleB.includes(flag)) distance += 1;
  }

  if (epA !== epB) distance += 1;

  return distance;
}

// Find the indexed position closest (by positionDistance) to `targetKey`.
// Returns { key, entries, distance }, or null if state.fenIndex is empty.
// Ties go to the first-encountered key (repertoire chapter/node order),
// consistent with the existing "first match wins" convention.
function findClosestPosition(targetKey) {
  let best = null;
  for (const [key, entries] of state.fenIndex) {
    const distance = positionDistance(targetKey, key);
    if (best === null || distance < best.distance) {
      best = { key, entries, distance };
    }
  }
  return best;
}

// Parse `input` as a FEN string. Returns the normalized FEN on success, or
// null if `input` is not a valid FEN.
function tryParseFen(input) {
  // A FEN's piece-placement field always contains '/' rank separators; PGN move
  // text never does. Requiring '/' keeps a lone legal move (e.g. "e4") from
  // being mis-detected as a FEN by a lenient Chess() constructor.
  if (!input.includes('/')) return null;
  try {
    return new Chess(input).fen();
  } catch {
    return null;
  }
}

// Parse `input` as PGN move text and play it out from the standard starting
// position. Returns the resulting FEN on success, or null if `input` is not
// a valid, non-empty move sequence.
function tryParsePgn(input) {
  try {
    const chess = new Chess();
    chess.loadPgn(input);
    if (chess.history().length === 0) return null;
    return chess.fen();
  } catch {
    return null;
  }
}

function runPositionSearch(rawInput) {
  const input = rawInput.trim();
  if (!input) {
    setSearchStatus('Enter a PGN move sequence or FEN position to search.', 'info');
    return;
  }

  const fenResult = tryParseFen(input);
  const kind = fenResult !== null ? 'FEN' : 'PGN';
  const fen = fenResult !== null ? fenResult : tryParsePgn(input);

  if (fen === null) {
    setSearchStatus('Not a valid PGN or FEN. Please enter a valid PGN move sequence or FEN position.', 'error');
    return;
  }

  const searchKey = fenKey(fen);
  const matches = state.fenIndex.get(searchKey) || [];
  if (matches.length === 0) {
    const closest = findClosestPosition(searchKey);
    if (closest !== null && closest.distance <= MAX_SIMILAR_DISTANCE) {
      const [match, ...rest] = closest.entries;
      selectChapter(match.chapterId, match.nodeId);

      let message =
        `Valid ${kind}, but no exact match was found. Jumped to the closest similar position ` +
        `in "${state.chapter.title}".`;
      if (rest.length > 0) {
        message += ` (Also reached by ${rest.length} other position${rest.length === 1 ? '' : 's'} in the repertoire.)`;
      }
      setSearchStatus(message, 'similar');
      return;
    }

    setSearchStatus(`Valid ${kind}, but no matching position was found in the repertoire.`, 'error');
    return;
  }

  const [match, ...rest] = matches;
  selectChapter(match.chapterId, match.nodeId);

  let message = `Found matching position from ${kind} — jumped to "${state.chapter.title}".`;
  if (rest.length > 0) {
    message += ` (Also reached by ${rest.length} other position${rest.length === 1 ? '' : 's'} in the repertoire.)`;
  }
  setSearchStatus(message, 'success');
}

function setSearchStatus(message, kind) {
  els.searchStatus.textContent = message;
  els.searchStatus.dataset.kind = kind;
  els.searchStatus.hidden = false;
}

function buildLinePgn() {
  const moves = getSelectedPath().filter((node) => node.san);
  let pgn = '';
  for (const node of moves) {
    if (node.ply % 2 === 1) {
      pgn += `${Math.ceil(node.ply / 2)}.${node.san} `;
    } else if (pgn === '') {
      pgn += `${Math.ceil(node.ply / 2)}...${node.san} `;
    } else {
      pgn += `${node.san} `;
    }
  }
  return pgn.trim();
}

function refreshExportPgn() {
  els.exportText.value = state.chapter ? buildLinePgn() : '';
}

const COPIED_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5" /></svg>';

async function copyExportPgn() {
  const text = els.exportText.value;
  if (!text) return;

  try {
    await navigator.clipboard.writeText(text);
  } catch {
    els.exportText.select();
    document.execCommand('copy');
  }

  const original = els.copyPgn.innerHTML;
  els.copyPgn.innerHTML = COPIED_ICON;
  setTimeout(() => {
    els.copyPgn.innerHTML = original;
  }, 1200);
}

function setDescription(text) {
  els.descriptionText.textContent = text;
  // Repertoire acknowledgements show on the home page, including while the
  // user is free-playing moves there (the scratch chapter) — only hide once a
  // real repertoire chapter is open.
  els.notesAck.hidden = Boolean(state.chapter) && state.chapter.id !== SCRATCH_ID;
}

function showLoadError(error) {
  setDescription(`Unable to load repertoire: ${error.message} Run the export script to generate data/repertoire.json.`);
}

function replaceHash(hash) {
  const url = hash ? `#${hash}` : `${window.location.pathname}${window.location.search}`;
  history.replaceState(null, '', url);
}
