import { Chessground } from 'chessground';
import { Chess } from 'chess.js';
import 'chessground/assets/chessground.base.css';
import 'chessground/assets/chessground.cburnett.css';
import './style.css';
import './board-theme.css';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const GENERAL_DESCRIPTION =
  'Get started by selecting a chapter or searching by PGN/FEN.';

// Maximum positionDistance for a non-exact match to be offered as the
// "closest similar position" — roughly "about one move away" (see
// positionDistance below).
const MAX_SIMILAR_DISTANCE = 6;

const QUIZ_DESCRIPTION = 'White to move: seize the initiative with precise attack!';

// Board color theme constants (logic in initBoardTheme()/applyBoardTheme() below).
// Declared up here so the top-level initBoardTheme() call isn't in their TDZ.
const BOARD_THEME_KEY = 'smg:board-theme';
const BOARD_THEMES = ['blue', 'brown'];
const DEFAULT_BOARD_THEME = 'blue';

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
  boardTheme: document.querySelector('#board-theme'),
  toggleSearch: document.querySelector('#toggle-search'),
  searchRow: document.querySelector('#search-row'),
  searchInput: document.querySelector('#search-input'),
  searchStatus: document.querySelector('#search-status'),
  toggleExport: document.querySelector('#toggle-export'),
  exportRow: document.querySelector('#export-row'),
  exportText: document.querySelector('#export-text'),
  copyPgn: document.querySelector('#copy-pgn'),
  toggleChallenge: document.querySelector('#challenge-bot'),
  challengeRow: document.querySelector('#challenge-row'),
  quizMode: document.querySelector('#quiz-mode'),
  quizStatus: document.querySelector('#quiz-status'),
  treePanel: document.querySelector('#tree-panel'),
};

const state = {
  repertoire: null,
  chapter: null,
  nodesById: new Map(),
  selectedNodeId: null,
  fenIndex: new Map(),
  quizActive: false,
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
  coordinates: true,
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
initBoardTheme();
init();

// A small grip in the board's bottom-right corner lets the user drag to resize
// the board within a modest range. The handle lives in `.board-frame` as a
// sibling of `#board`, so `ground.redrawAll()` (which rebuilds the board's inner
// DOM) never wipes it out from under an active drag.
function setupBoardResize() {
  const frame = document.querySelector('.board-frame');
  const handle = document.querySelector('#board-resize');
  if (!frame || !handle) return;

  let drag = null;
  let initialBoardSize = null;

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
    const size = Math.max(minSize, Math.min(drag.startSize + delta, maxSize));
    frame.style.maxWidth = 'none';
    frame.style.width = `${size}px`;
    ground.redrawAll();
  });

  const endDrag = (event) => {
    if (!drag) return;
    drag = null;
    if (handle.hasPointerCapture(event.pointerId)) {
      handle.releasePointerCapture(event.pointerId);
    }
  };
  handle.addEventListener('pointerup', endDrag);
  handle.addEventListener('pointercancel', endDrag);
}

// Board color theme — blue (default) or the classic brown — toggled by the
// #board-theme button and remembered across visits. The actual colors (board
// squares + highlights, and on brown the warmed nav bar / resize grip) live in
// board-theme.css, keyed off a `theme-*` class on the root <html> element so
// both the board and the surrounding chrome can react; here we only flip that
// class, persist the choice, and reflect the active theme in the button. The
// constants (BOARD_THEME_KEY / BOARD_THEMES / DEFAULT_BOARD_THEME) are declared
// near the top of the file so this section's top-level call isn't in their TDZ.
function applyBoardTheme(theme) {
  const root = document.documentElement;
  for (const name of BOARD_THEMES) {
    root.classList.toggle(`theme-${name}`, name === theme);
  }
  for (const swatch of els.boardTheme.querySelectorAll('.theme-swatch')) {
    swatch.classList.toggle('is-active', swatch.dataset.theme === theme);
  }
  const next = theme === 'blue' ? 'brown' : 'blue';
  const label = `Switch to ${next} board`;
  els.boardTheme.setAttribute('aria-label', label);
  els.boardTheme.title = label;
}

function currentBoardTheme() {
  return document.documentElement.classList.contains('theme-brown') ? 'brown' : 'blue';
}

function initBoardTheme() {
  let theme = DEFAULT_BOARD_THEME;
  try {
    const saved = localStorage.getItem(BOARD_THEME_KEY);
    if (BOARD_THEMES.includes(saved)) theme = saved;
  } catch {
    // localStorage may be unavailable (e.g. private mode); use the default.
  }
  applyBoardTheme(theme);

  els.boardTheme.addEventListener('click', () => {
    const next = currentBoardTheme() === 'blue' ? 'brown' : 'blue';
    applyBoardTheme(next);
    try {
      localStorage.setItem(BOARD_THEME_KEY, next);
    } catch {
      // Persistence is best-effort; the in-page switch still works without it.
    }
  });
}

async function init() {
  setDescription(GENERAL_DESCRIPTION);

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

function renderChapterOptions() {
  for (const chapter of state.repertoire.chapters) {
    const option = document.createElement('option');
    option.value = chapter.id;
    option.textContent = chapter.title;
    els.chapterSelect.append(option);
  }
}

function selectChapter(chapterId, preferredNodeId = null, updateHash = true) {
  const chapter = state.repertoire.chapters.find((item) => item.id === chapterId);
  if (!chapter) return;

  state.chapter = chapter;
  state.nodesById = new Map(chapter.nodes.map((node) => [node.id, node]));
  els.chapterSelect.value = chapter.id;

  const rootId = getRootNode().id;
  const nextNodeId = preferredNodeId && state.nodesById.has(preferredNodeId) ? preferredNodeId : rootId;
  selectNode(nextNodeId, updateHash);
  renderTree();
}

function clearSelection() {
  state.chapter = null;
  state.nodesById = new Map();
  state.selectedNodeId = null;
  ground.set({ fen: START_FEN, lastMove: undefined });
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
  });
  setDescription(description);
  renderTree();
  updateNavigationState();
  if (!els.exportRow.hidden) refreshExportPgn();

  if (updateHash) {
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
  button.textContent = node.san;
  button.addEventListener('click', () => selectNode(node.id));
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
  button.addEventListener('click', () => selectNode(node.id));
  return button;
}

function inlineLabel(node, forceNumber) {
  const moveNumber = Math.ceil(node.ply / 2);
  if (node.ply % 2 === 1) {
    return `${moveNumber}.${node.san}`;
  }
  return forceNumber ? `${moveNumber}...${node.san}` : node.san;
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
  const node = getSelectedNode();
  const mainlineChild = node.children.map((id) => state.nodesById.get(id)).find((child) => child.isMainline);
  const nextId = mainlineChild?.id || node.children[0];
  if (nextId) {
    selectNode(nextId);
  }
}

function selectEnd() {
  if (state.quizActive) return;
  if (!state.chapter) return;

  let node = getSelectedNode();
  while (node.children.length > 0) {
    const mainlineChild = node.children.map((id) => state.nodesById.get(id)).find((child) => child.isMainline);
    node = mainlineChild || state.nodesById.get(node.children[0]);
  }
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
  return state.chapter.nodes.find((node) => node.parentId === null);
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

// Pick one of `node`'s children uniformly at random, optionally restricted to
// children matching `predicate`. Returns undefined if there are no candidates.
function pickRandomChild(node, predicate = () => true) {
  const children = node.children.map((id) => state.nodesById.get(id)).filter(predicate);
  if (children.length === 0) return undefined;
  return children[Math.floor(Math.random() * children.length)];
}

function setQuizStatus(message, kind) {
  els.quizStatus.textContent = message;
  els.quizStatus.dataset.kind = kind;
  els.quizStatus.hidden = false;
}

function clearQuizStatus() {
  els.quizStatus.hidden = true;
  els.quizStatus.textContent = '';
  delete els.quizStatus.dataset.kind;
}

function startQuiz() {
  if (!state.chapter) {
    setQuizStatus('Select a chapter first.', 'error');
    return;
  }

  const startNode = getSelectedNode();
  if (startNode.children.length === 0) {
    setQuizStatus('This is the end of the chapter — there are no more moves to quiz.', 'error');
    return;
  }

  let currentNode = startNode;
  let openingMessage = null;
  if (turnColorOf(startNode.fen) === 'black') {
    const blackReply = pickRandomChild(startNode, (child) => child.children.length > 0);
    if (!blackReply) {
      setQuizStatus('This is the end of the chapter — there are no more moves to quiz.', 'error');
      return;
    }
    currentNode = blackReply;
    openingMessage = `Black played ${blackReply.san}. Find White's best move.`;
  }

  if (!els.searchRow.hidden) toggleToolRow(els.searchRow, els.toggleSearch);
  if (!els.exportRow.hidden) toggleToolRow(els.exportRow, els.toggleExport);
  if (!els.challengeRow.hidden) toggleToolRow(els.challengeRow, els.toggleChallenge);

  state.quizActive = true;
  state.selectedNodeId = currentNode.id;

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

  if (openingMessage) {
    setQuizStatus(openingMessage, 'info');
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

  els.quizMode.querySelector('.tool-label').textContent = 'Quit quiz mode';
  els.quizMode.setAttribute('aria-expanded', 'true');
  els.quizMode.setAttribute('aria-label', 'Quit quiz mode');
  els.quizMode.title = 'Quit quiz mode';
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

  els.quizMode.querySelector('.tool-label').textContent = 'Quiz mode';
  els.quizMode.setAttribute('aria-expanded', 'false');
  els.quizMode.setAttribute('aria-label', "Quiz mode — practice White's moves from here");
  els.quizMode.title = "Quiz mode — practice White's moves from here";

  // Resyncs description, tree, hash, and nav-button disabled state.
  selectNode(state.selectedNodeId, true);

  if (message) {
    setQuizStatus(message, kind);
  } else {
    clearQuizStatus();
  }
}

function onUserMove(orig, dest) {
  if (!state.quizActive) return;

  const before = getSelectedNode();
  const chess = new Chess(before.fen);

  let result;
  try {
    result = chess.move({ from: orig, to: dest, promotion: 'q' });
  } catch {
    ground.set({
      fen: before.fen,
      turnColor: turnColorOf(before.fen),
      lastMove: getLastMove(before),
      movable: { dests: computeDests(before.fen) },
    });
    setQuizStatus("That move isn't legal here.", 'error');
    return;
  }

  const whiteNode = mainlineChild(before);
  const isRepertoireMove = whiteNode && fenKey(chess.fen()) === fenKey(whiteNode.fen);

  if (!isRepertoireMove) {
    ground.set({
      fen: before.fen,
      turnColor: turnColorOf(before.fen),
      lastMove: getLastMove(before),
      movable: { dests: computeDests(before.fen) },
    });
    setQuizStatus(`${result.san} is not the repertoire move here. Try again.`, 'error');
    return;
  }

  // Correct move.
  state.selectedNodeId = whiteNode.id;
  ground.set({
    fen: whiteNode.fen,
    turnColor: turnColorOf(whiteNode.fen),
    lastMove: getLastMove(whiteNode),
    movable: { dests: new Map() },
  });
  setQuizStatus('Correct!', 'success');

  const blackNode = pickRandomChild(whiteNode);

  if (!blackNode) {
    endQuiz(`Quiz complete — you've reached the end of this line.`, 'success');
    return;
  }

  setTimeout(() => {
    if (!state.quizActive) return;

    state.selectedNodeId = blackNode.id;
    ground.set({
      fen: blackNode.fen,
      turnColor: turnColorOf(blackNode.fen),
      lastMove: getLastMove(blackNode),
      movable: { dests: computeDests(blackNode.fen) },
    });
    setQuizStatus(`Correct! Black played ${blackNode.san}.`, 'success');

    if (blackNode.children.length === 0) {
      endQuiz(`Quiz complete — you've reached the end of this line.`, 'success');
    }
  }, 350);
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
function fenKey(fen) {
  return fen.trim().split(/\s+/).slice(0, 4).join(' ');
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
        `in "${state.chapter.title}" (differs by about ${closest.distance} square${closest.distance === 1 ? '' : 's'}).`;
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
}

function showLoadError(error) {
  setDescription(`Unable to load repertoire: ${error.message} Run the export script to generate data/repertoire.json.`);
}

function replaceHash(hash) {
  const url = hash ? `#${hash}` : `${window.location.pathname}${window.location.search}`;
  history.replaceState(null, '', url);
}
