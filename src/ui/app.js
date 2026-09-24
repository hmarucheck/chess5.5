// The application controller: owns the current game, the board view, the
// clocks and the engine client, and keeps every panel in sync with them.

import { START_FEN } from '../engine/constants.js';
import { Game, RESULT_NONE, RESULT_WHITE, RESULT_BLACK, REASONS } from '../engine/game.js';
import { validateFen } from '../engine/fen.js';
import { exportPgn, importPgn } from '../engine/pgn.js';
import { sanToFigurine } from '../engine/san.js';
import { identifyOpening } from '../engine/openings.js';
import { explainEvaluation } from '../ai/evaluate.js';
import { LEVELS, levelInfo } from '../ai/engine.js';
import { bookMoves } from '../ai/book.js';
import { parseFen } from '../engine/fen.js';
import { BoardView, boardFromFen, nameToIndex, indexToName } from './board-view.js';
import { SoundBoard } from './sound.js';
import { ChessClock, TIME_CONTROLS, formatClockTime } from './clock.js';
import { EngineClient, EngineCancelled } from './engine-client.js';
import { classifyGame, evalGraphSvg, formatScore, scoreToCp, winChance, CLASSIFICATIONS } from './review.js';
import { loadSettings, saveSettings, loadJson, saveJson, loadStats, recordResult } from './storage.js';
import {
  $, $$, escapeHtml, openDialog, closeDialog, initDialogs, confirmAction, toast,
  copyText, downloadText, readFileAsText,
} from './dom.js';
import { pieceSvg } from './pieces.js';

export const BOARD_THEMES = [
  { id: 'walnut', name: 'Walnut', light: '#ecd9ba', dark: '#b3855b' },
  { id: 'tournament', name: 'Tournament', light: '#e8ebd3', dark: '#6f8f59' },
  { id: 'ice', name: 'Ice', light: '#e0e8ef', dark: '#7d9ab2' },
  { id: 'slate', name: 'Slate', light: '#dddcd7', dark: '#898d91' },
  { id: 'coral', name: 'Coral', light: '#f2e0d7', dark: '#bb7e70' },
  { id: 'midnight', name: 'Midnight', light: '#a3adbd', dark: '#4f5b72' },
];

const ANIMATION_MS = { off: 0, fast: 110, normal: 190, slow: 320 };
const PIECE_VALUES = { 1: 1, 2: 3, 3: 3, 4: 5, 5: 9 };
const REVIEW_ORDER = ['book', 'best', 'excellent', 'good', 'inaccuracy', 'mistake', 'blunder'];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const colorOf = (turn) => (turn === 0 ? 'w' : 'b');
const otherColor = (color) => (color === 'w' ? 'b' : 'w');
const colorWord = (color) => (color === 'w' ? 'White' : 'Black');

function kingSquare(board, color) {
  const code = color === 'w' ? 6 : 14;
  for (let i = 0; i < 64; i++) if (board[i] === code) return i;
  return -1;
}

function formatCount(n) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(n);
}

export class App {
  constructor() {
    this.settings = loadSettings();
    this.stats = loadStats();
    this.sound = new SoundBoard();
    this.engine = new EngineClient();
    this.game = new Game();
    this.config = {
      mode: 'ai',
      humanColor: 'w',
      colorChoice: 'w',
      level: 4,
      levels: { w: 6, b: 6 },
      timeControl: 'none',
      customMinutes: 10,
      customIncrement: 0,
      startFen: '',
    };
    this.viewPly = 0;
    this.clock = null;
    this.clockStarted = false;
    this.gameId = 0;
    this.aiThinking = false;
    this.paused = false;
    this.analysis = { enabled: false, token: 0, info: null, fen: null };
    this.hint = null;
    this.review = null;
    this.reviewRunning = false;
    this.lastAiScore = null;
    this.aiInfo = null;
    this.displayCache = { ply: -1, game: null, id: -1 };

    this.board = new BoardView($('#board'), {
      canPick: (square) => this.canPick(square),
      getDests: (square) => this.getDests(square),
      onMove: (from, to, opts) => this.onBoardMove(from, to, opts),
      onBoardClick: () => this.onBoardClick(),
    });
  }

  // ---------------------------------------------------------------------------
  // Start-up
  // ---------------------------------------------------------------------------

  init() {
    initDialogs();
    this.buildSettingsUi();
    this.buildNewGameUi();
    this.bindControls();
    this.bindKeyboard();
    this.applySettings();

    const unlock = () => this.sound.unlock();
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock);

    this.engine.onStatus = (mode) => {
      if (mode === 'main-thread') toast('Running the engine on the page itself; it may pause the page while it thinks.');
    };

    const saved = loadJson('game');
    if (!(saved && this.restoreGame(saved))) {
      this.startNewGame({ ...this.config }, { quiet: true });
    }
  }

  // ---------------------------------------------------------------------------
  // Game lifecycle
  // ---------------------------------------------------------------------------

  startNewGame(config, { quiet = false } = {}) {
    this.engine.cancelAll();
    this.gameId++;
    this.destroyClock();
    this.config = { ...config, levels: { ...config.levels } };
    if (this.config.colorChoice === 'random') this.config.humanColor = Math.random() < 0.5 ? 'w' : 'b';
    else this.config.humanColor = this.config.colorChoice || this.config.humanColor || 'w';

    this.game = new Game(this.config.startFen || START_FEN);
    this.game.headers = this.defaultHeaders();
    this.viewPly = 0;
    this.review = null;
    this.hint = null;
    this.lastAiScore = null;
    this.aiInfo = null;
    this.aiThinking = false;
    this.paused = false;
    this.analysis.info = null;
    this.analysis.enabled = this.config.mode === 'analysis' ? true : this.config.mode === 'pvp' ? this.analysis.enabled : false;

    this.setupClock();
    this.board.setOrientation(this.config.mode === 'ai' ? this.config.humanColor : 'w');
    this.board.clearUserAnnotations();
    this.renderAll({ animate: false });
    this.saveGame();
    if (!quiet) this.sound.play('start');
    this.engine.request('newgame', {}).catch(() => {});
    if (this.isAiTurn()) setTimeout(() => this.requestAiMove(), 350);
    this.runAnalysis();
  }

  defaultHeaders() {
    const { mode, humanColor } = this.config;
    const names = { w: 'White', b: 'Black' };
    if (mode === 'ai') {
      const info = levelInfo(this.config.level);
      names[humanColor] = 'You';
      names[otherColor(humanColor)] = `Computer (level ${info.level})`;
    } else if (mode === 'aivai') {
      names.w = `Computer (level ${this.config.levels.w})`;
      names.b = `Computer (level ${this.config.levels.b})`;
    }
    const event = { ai: 'Game against the computer', pvp: 'Two-player game', aivai: 'Computer match', analysis: 'Analysis' }[mode];
    const headers = { Event: event, White: names.w, Black: names.b };
    const tc = this.timeControl();
    if (tc) headers.TimeControl = `${Math.round(tc.initialMs / 1000)}+${Math.round(tc.incrementMs / 1000)}`;
    return headers;
  }

  timeControl() {
    const { mode, timeControl, customMinutes, customIncrement } = this.config;
    if (mode === 'analysis' || timeControl === 'none') return null;
    if (timeControl === 'custom') {
      const minutes = Math.max(0.5, Number(customMinutes) || 10);
      return { initialMs: minutes * 60000, incrementMs: Math.max(0, Number(customIncrement) || 0) * 1000 };
    }
    const preset = TIME_CONTROLS.find((t) => t.id === timeControl);
    if (!preset || !preset.initial) return null;
    return { initialMs: preset.initial * 1000, incrementMs: preset.increment * 1000 };
  }

  setupClock(snapshot = null) {
    this.destroyClock();
    const tc = this.timeControl();
    if (!tc) {
      this.renderClocks(null);
      return;
    }
    this.clock = new ChessClock({
      initialMs: tc.initialMs,
      incrementMs: tc.incrementMs,
      onTick: (state) => this.renderClocks(state),
      onFlag: (color) => this.onFlag(color),
      onLowTime: (color) => {
        if (this.config.mode !== 'ai' || color === this.config.humanColor) this.sound.play('lowtime');
      },
    });
    if (snapshot) {
      this.clock.times.w = snapshot.w;
      this.clock.times.b = snapshot.b;
    }
    this.clockStarted = false;
    this.clock.emit();
  }

  destroyClock() {
    if (this.clock) this.clock.destroy();
    this.clock = null;
    this.clockStarted = false;
  }

  onFlag(color) {
    if (this.game.isOver) return;
    this.engine.cancelAll();
    this.aiThinking = false;
    this.game.timeout(color === 'w' ? 0 : 1);
    this.endGame();
  }

  // Called after every move, from the board, the move box or the engine.
  afterMove(record, { animate = true } = {}) {
    if (this.clock && !this.game.isOver) {
      if (!this.clockStarted) {
        this.clockStarted = true;
        this.clock.start(otherColor(record.color));
      } else {
        this.clock.press(record.color);
      }
      record.clock = this.clock.get(record.color);
    } else if (this.clock) {
      record.clock = this.clock.get(record.color);
    }

    this.viewPly = this.game.ply;
    this.hint = null;
    if (this.review) this.review = null;
    this.displayCache.id = -1;

    if (!this.game.isOver) {
      if (record.check) this.sound.play('check');
      else if (record.promotion) this.sound.play('promote');
      else if (record.flags & 4) this.sound.play('castle');
      else if (record.captured) this.sound.play('capture');
      else this.sound.play('move');
    } else if (record.captured) {
      this.sound.play('capture');
    } else {
      this.sound.play('move');
    }

    this.renderAll({ animate });
    this.saveGame();

    if (this.game.isOver) {
      this.endGame();
      return;
    }
    if (this.isAiTurn()) this.requestAiMove();
    this.runAnalysis();
  }

  endGame() {
    if (this.clock) this.clock.stop();
    this.aiThinking = false;
    const { mode, humanColor } = this.config;
    const result = this.game.result;
    let title;
    let outcome = null;
    if (mode === 'ai') {
      const humanWon = (result === RESULT_WHITE && humanColor === 'w') || (result === RESULT_BLACK && humanColor === 'b');
      const humanLost = (result === RESULT_WHITE && humanColor === 'b') || (result === RESULT_BLACK && humanColor === 'w');
      outcome = humanWon ? 'win' : humanLost ? 'loss' : 'draw';
      title = humanWon ? 'You won' : humanLost ? 'You lost' : 'Draw';
      this.sound.play(humanWon ? 'win' : humanLost ? 'lose' : 'draw');
      if (!this.game.statsRecorded) {
        this.stats = recordResult(this.stats, this.config.level, outcome);
        this.game.statsRecorded = true;
        this.renderStats();
      }
    } else {
      title = result === RESULT_WHITE ? 'White wins' : result === RESULT_BLACK ? 'Black wins' : 'Draw';
      this.sound.play(result === '1/2-1/2' ? 'draw' : 'win');
    }
    this.renderAll({ animate: false });
    this.saveGame();

    $('#game-over-score').textContent = result === '1/2-1/2' ? '½–½' : result.replace('-', '–');
    $('#game-over-title').textContent = title;
    $('#game-over-reason').textContent = this.game.describeResult();
    const dialog = $('#game-over-dialog');
    dialog.dataset.outcome = outcome || (result === '1/2-1/2' ? 'draw' : 'decisive');
    // Short pause so the final move is seen first; skip it if the game changed meanwhile.
    const id = this.gameId;
    const ply = this.game.ply;
    if (mode !== 'analysis') {
      setTimeout(() => {
        if (id === this.gameId && ply === this.game.ply && this.game.isOver) openDialog(dialog);
      }, 650);
    }
  }

  // ---------------------------------------------------------------------------
  // Who moves
  // ---------------------------------------------------------------------------

  isHumanColor(color) {
    const { mode, humanColor } = this.config;
    if (mode === 'pvp' || mode === 'analysis') return true;
    if (mode === 'ai') return color === humanColor;
    return false;
  }

  isAiTurn() {
    if (this.game.isOver || this.paused) return false;
    const { mode } = this.config;
    if (mode === 'aivai') return true;
    if (mode === 'ai') return colorOf(this.game.turn) !== this.config.humanColor;
    return false;
  }

  isLive() {
    return this.viewPly === this.game.ply;
  }

  // The game as it stands at the viewed ply (a scratch copy when looking back).
  displayGame() {
    if (this.isLive()) return this.game;
    if (this.displayCache.ply !== this.viewPly || this.displayCache.id !== this.gameId || !this.displayCache.game) {
      this.displayCache = { ply: this.viewPly, id: this.gameId, game: new Game(this.game.fenAt(this.viewPly)) };
    }
    return this.displayCache.game;
  }

  canInteract() {
    const { mode } = this.config;
    if (mode === 'analysis') return true;
    if (!this.isLive() || this.game.isOver || this.aiThinking) return false;
    return this.isHumanColor(colorOf(this.game.turn));
  }

  canPick(square) {
    if (!this.canInteract()) return false;
    const game = this.displayGame();
    const piece = game.pieceAt(indexToName(square));
    if (!piece) return false;
    return piece.color === colorOf(game.turn) && this.isHumanColor(piece.color);
  }

  getDests(square) {
    const game = this.displayGame();
    const seen = new Map();
    for (const m of game.moveObjects(indexToName(square))) {
      const to = nameToIndex(m.to);
      if (!seen.has(to)) seen.set(to, { to, capture: m.capture });
    }
    return [...seen.values()];
  }

  onBoardClick() {
    if (!this.isLive() && this.config.mode !== 'analysis' && !this.game.isOver) {
      this.goTo(this.game.ply);
    }
  }

  async onBoardMove(from, to, { animate }) {
    const fromName = indexToName(from);
    const toName = indexToName(to);
    const game = this.displayGame();
    let promotion = null;
    if (game.isPromotion(fromName, toName)) {
      if (this.settings.autoQueen) {
        promotion = 'q';
      } else {
        promotion = await this.board.choosePromotion(to, colorOf(game.turn));
        if (!promotion) return false;
      }
    }
    return this.playHumanMove({ from: fromName, to: toName, promotion }, { animate });
  }

  // Plays a move for a human player; input may be SAN, UCI or {from, to}.
  playHumanMove(input, { animate = true } = {}) {
    if (!this.canInteract()) return false;
    if (this.config.mode === 'analysis') {
      if (!this.isLive()) {
        this.game.truncate(this.viewPly);
        this.displayCache.id = -1;
      }
      // On the analysis board a resignation or timeout doesn't stop exploration.
      if (this.game.isOver && ![REASONS.checkmate, REASONS.stalemate].includes(this.game.reason)) {
        this.game.setResult(RESULT_NONE, null);
      }
    }
    const record = this.game.move(input, { allowAfterEnd: this.config.mode === 'analysis' });
    if (!record) {
      this.sound.play('illegal');
      return false;
    }
    this.afterMove(record, { animate });
    return true;
  }

  // ---------------------------------------------------------------------------
  // Engine: playing moves
  // ---------------------------------------------------------------------------

  async requestAiMove() {
    if (!this.isAiTurn() || this.aiThinking) return;
    const id = this.gameId;
    const ply = this.game.ply;
    const color = colorOf(this.game.turn);
    const level = this.config.mode === 'aivai' ? this.config.levels[color] : this.config.level;
    const clock = this.clock
      ? { remainingMs: this.clock.get(color), incrementMs: this.clock.incrementMs }
      : null;
    this.aiThinking = true;
    this.aiInfo = null;
    this.renderThinking();
    this.board.setInteractive(false);
    const started = performance.now();
    try {
      const result = await this.engine.play(
        { fen: this.game.startFen, moves: this.game.uciList(), level, clock },
        (info) => {
          if (id !== this.gameId || ply !== this.game.ply) return;
          this.aiInfo = { ...info, ply };
          if (this.config.mode === 'aivai') this.renderEvalBar();
        },
      );
      if (id !== this.gameId || ply !== this.game.ply) return;
      const minDelay = this.config.mode === 'aivai' ? 450 : result.source === 'book' ? 420 : 220;
      const elapsed = performance.now() - started;
      if (elapsed < minDelay) await sleep(minDelay - elapsed);
      if (id !== this.gameId || ply !== this.game.ply || this.paused) {
        this.aiThinking = false;
        this.renderThinking();
        return;
      }
      this.aiThinking = false;
      if (result.score) this.lastAiScore = scoreToCp(result.score);
      if (result.whiteScore) this.aiInfo = { whiteScore: result.whiteScore, ply: ply + 1 };
      const record = result.move ? this.game.move(result.move) : null;
      if (!record) {
        this.renderThinking();
        toast('The computer could not find a move.', { tone: 'warn' });
        return;
      }
      this.afterMove(record, { animate: true });
    } catch (err) {
      if (id === this.gameId) {
        this.aiThinking = false;
        this.renderThinking();
        this.renderControls();
      }
      if (!(err instanceof EngineCancelled)) {
        console.error(err);
        toast(`The engine stopped with an error: ${err.message}`, { tone: 'warn' });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Engine: analysis and hints
  // ---------------------------------------------------------------------------

  analysisAllowed() {
    const { mode } = this.config;
    if (this.reviewRunning) return false;
    if (mode === 'analysis' || this.game.isOver) return true;
    if (mode === 'pvp') return true;
    return false;
  }

  runAnalysis() {
    const token = ++this.analysis.token;
    if (!this.analysis.enabled || !this.analysisAllowed()) {
      this.renderAnalysisIdle();
      return;
    }
    this.engine.cancelAll();
    const moves = this.game.uciList().slice(0, this.viewPly);
    const fen = this.game.fenAt(this.viewPly);
    this.analysis.info = null;
    this.analysis.fen = fen;
    this.renderAnalysis();
    this.engine
      .analyze({ fen: this.game.startFen, moves, timeMs: 20000, depth: 40 }, (info) => {
        if (token !== this.analysis.token) return;
        this.analysis.info = info;
        this.renderAnalysis();
        this.renderEvalBar();
        this.renderArrows();
      })
      .then((result) => {
        if (token !== this.analysis.token) return;
        if (result && result.terminal) {
          this.analysis.info = { whiteScore: result.whiteScore, depth: 0, pv: [], nodes: 0, nps: 0, terminal: result.terminal };
          this.renderAnalysis();
          this.renderEvalBar();
        }
      })
      .catch((err) => {
        if (!(err instanceof EngineCancelled)) console.error(err);
      });
  }

  stopAnalysis() {
    this.analysis.token++;
    this.engine.cancelAll();
  }

  setAnalysisEnabled(enabled) {
    if (enabled && !this.analysisAllowed()) {
      toast(this.config.mode === 'ai'
        ? 'Live analysis unlocks when the game ends. Use a hint if you are stuck.'
        : 'Live analysis is off while the computers play.');
      $('#analysis-toggle').checked = false;
      return;
    }
    this.analysis.enabled = enabled;
    $('#analysis-toggle').checked = enabled;
    if (enabled) this.runAnalysis();
    else {
      this.stopAnalysis();
      this.analysis.info = null;
      this.renderAnalysisIdle();
      this.renderEvalBar();
      this.renderArrows();
    }
  }

  async showHint() {
    const { mode } = this.config;
    if (mode === 'aivai') return;
    if (!this.isLive() && mode !== 'analysis') {
      toast('Return to the current position to ask for a hint.');
      return;
    }
    if (this.game.isOver && mode !== 'analysis') return;
    if (this.aiThinking) {
      toast('Wait for the computer to finish its move.');
      return;
    }
    const game = this.displayGame();
    if (!game.legalMoves().length) return;
    const ply = this.viewPly;
    const id = this.gameId;
    this.analysis.token++;
    this.engine.cancelAll();
    $('#btn-hint').disabled = true;
    toast('Looking for a good move…', { duration: 1400 });
    try {
      const result = await this.engine.analyze({
        fen: this.game.startFen,
        moves: this.game.uciList().slice(0, ply),
        timeMs: 1200,
      });
      if (id !== this.gameId || ply !== this.viewPly || !result.move) return;
      const san = game.move(result.move) ? game.undo().san : result.move;
      this.hint = { ply, from: nameToIndex(result.move.slice(0, 2)), to: nameToIndex(result.move.slice(2, 4)), san };
      this.renderArrows();
      toast(`Hint: ${this.settings.figurines ? sanToFigurine(san) : san}`, { duration: 3200 });
    } catch (err) {
      if (!(err instanceof EngineCancelled)) toast('The hint could not be computed.', { tone: 'warn' });
    } finally {
      this.renderControls();
      if (this.analysis.enabled) this.runAnalysis();
    }
  }

  // ---------------------------------------------------------------------------
  // Player actions
  // ---------------------------------------------------------------------------

  takeback() {
    const { mode } = this.config;
    if (mode === 'aivai' || this.game.ply === 0) return;
    this.engine.cancelAll();
    this.gameId++; // drop any engine answer still in flight
    this.aiThinking = false;
    closeDialog($('#game-over-dialog'));

    this.game.undo();
    if (mode === 'ai') {
      while (this.game.ply > 0 && colorOf(this.game.turn) !== this.config.humanColor) this.game.undo();
    }

    // Restore both clocks to their times after each side's last remaining move.
    if (this.clock) {
      for (const color of ['w', 'b']) {
        const last = [...this.game.history].reverse().find((r) => r.color === color && r.clock !== null);
        this.clock.times[color] = last ? last.clock : this.clock.initialMs;
      }
      this.clock.stop();
      this.clock.flagged = null;
      if (this.game.ply > 0) {
        this.clockStarted = true;
        this.clock.start(colorOf(this.game.turn));
      } else {
        this.clockStarted = false;
      }
    }

    this.viewPly = this.game.ply;
    this.review = null;
    this.hint = null;
    this.displayCache.id = -1;
    this.renderAll({ animate: true });
    this.saveGame();
    if (this.isAiTurn()) this.requestAiMove();
    this.runAnalysis();
  }

  async resign() {
    const { mode, humanColor } = this.config;
    if (this.game.isOver || (mode !== 'ai' && mode !== 'pvp')) return;
    const color = mode === 'ai' ? humanColor : colorOf(this.game.turn);
    if (this.settings.confirmResign) {
      const ok = await confirmAction({
        title: 'Resign this game?',
        message: mode === 'ai' ? 'The computer will be awarded the win.' : `${colorWord(color)} resigns and ${colorWord(otherColor(color))} wins.`,
        confirmLabel: 'Resign',
        danger: true,
      });
      if (!ok || this.game.isOver) return;
    }
    this.engine.cancelAll();
    this.game.resign(color === 'w' ? 0 : 1);
    this.endGame();
  }

  async offerDraw() {
    const { mode } = this.config;
    if (this.game.isOver) return;
    if (mode === 'pvp') {
      const side = colorWord(otherColor(colorOf(this.game.turn)));
      const ok = await confirmAction({
        title: 'Draw offered',
        message: `${colorWord(colorOf(this.game.turn))} offers a draw. Does ${side} accept?`,
        confirmLabel: 'Accept draw',
        cancelLabel: 'Decline',
      });
      if (ok && !this.game.isOver) {
        this.game.agreeDraw();
        this.endGame();
      }
      return;
    }
    if (mode !== 'ai') return;
    if (this.aiThinking) {
      toast('Offer the draw on your own turn.');
      return;
    }
    if (this.game.ply < 10) {
      toast('The computer declines: it is too early for a draw.');
      return;
    }
    const id = this.gameId;
    const ply = this.game.ply;
    try {
      const result = await this.engine.analyze({ fen: this.game.startFen, moves: this.game.uciList(), timeMs: 700 });
      if (id !== this.gameId || ply !== this.game.ply || this.game.isOver) return;
      // Score is from the human's side (it's their turn); the computer's view is the opposite.
      const aiView = -scoreToCp(result.score);
      const accept = aiView < -60 || (Math.abs(aiView) <= 30 && this.game.ply >= 60);
      if (accept) {
        this.game.agreeDraw();
        this.endGame();
      } else {
        toast(aiView > 150 ? 'The computer declines. It likes its position.' : 'The computer declines the draw.');
      }
    } catch (err) {
      if (!(err instanceof EngineCancelled)) toast('The draw offer could not be answered.', { tone: 'warn' });
    }
  }

  togglePause() {
    if (this.config.mode !== 'aivai' || this.game.isOver) return;
    this.paused = !this.paused;
    if (this.paused) {
      this.engine.cancelAll();
      this.aiThinking = false;
      if (this.clock) this.clock.stop();
    } else {
      if (this.clock && this.clockStarted) this.clock.start(colorOf(this.game.turn));
      this.requestAiMove();
    }
    this.renderControls();
    this.renderThinking();
    this.renderStatus();
  }

  goTo(ply) {
    const target = Math.max(0, Math.min(this.game.ply, ply));
    if (target === this.viewPly) return;
    this.viewPly = target;
    this.renderPosition({ animate: true });
    this.renderMoves();
    this.renderStatus();
    this.renderMaterial();
    this.renderControls();
    this.renderEvalBar();
    this.renderReviewCursor();
    if (this.analysis.enabled) this.runAnalysis();
  }

  flip() {
    this.board.flip();
    this.renderPlayers();
    this.renderMaterial();
    this.renderEvalBar();
    this.renderClocks(this.clock ? { w: this.clock.get('w'), b: this.clock.get('b'), running: this.clock.running } : null);
    this.saveGame();
  }

  submitTypedMove(text) {
    const input = text.trim();
    if (!input) return;
    if (!this.canInteract()) {
      toast(this.game.isOver ? 'The game is over.' : !this.isLive() ? 'Go to the latest move to play.' : 'It is not your turn.');
      return;
    }
    if (!this.playHumanMove(input)) {
      toast(`"${input}" is not a legal move here.`, { tone: 'warn' });
      return;
    }
    $('#move-input').value = '';
  }

  // ---------------------------------------------------------------------------
  // Review
  // ---------------------------------------------------------------------------

  async startReview() {
    const { mode } = this.config;
    if (this.game.ply === 0) {
      toast('Play at least one move before reviewing.');
      return;
    }
    if (mode === 'ai' && !this.game.isOver) {
      toast('Finish the game first, then review it.');
      return;
    }
    if (mode === 'aivai' && !this.game.isOver && !this.paused) {
      toast('Pause the match or let it finish before reviewing.');
      return;
    }
    this.stopAnalysis();
    this.reviewRunning = true;
    const id = this.gameId;
    const ply = this.game.ply;
    const startFen = this.game.startFen;
    const uci = this.game.uciList();
    const positions = [];
    for (let i = 0; i <= ply; i++) positions.push({ fen: startFen, moves: uci.slice(0, i) });

    $('#review-start').hidden = true;
    $('#review-results').hidden = true;
    $('#review-progress').hidden = false;
    this.setReviewProgress(0, positions.length);
    const partial = [];
    try {
      const timeMsPerMove = Number($('#review-depth').value) || 300;
      const results = await this.engine.review({ positions, timeMsPerMove }, ({ index, analysis }) => {
        partial[index] = analysis;
        this.setReviewProgress(index + 1, positions.length);
      });
      if (id !== this.gameId || ply !== this.game.ply) return;
      this.reviewRunning = false;
      this.finishReview(results);
    } catch (err) {
      if (!(err instanceof EngineCancelled)) toast('The review stopped because of an error.', { tone: 'warn' });
      $('#review-start').hidden = false;
      $('#review-progress').hidden = true;
    } finally {
      this.reviewRunning = false;
      if (this.analysis.enabled) this.runAnalysis();
    }
  }

  setReviewProgress(done, total) {
    $('#review-progress-fill').style.width = `${Math.round((done / total) * 100)}%`;
    $('#review-progress-text').textContent = `Analysed ${done} of ${total} positions`;
  }

  finishReview(results) {
    const history = this.game.history;
    const startFen = this.game.startFen;
    const standardStart = startFen === START_FEN;
    const evals = results.map((r) => r.whiteScore);
    const bestMoves = results.map((r) => r.move);
    const legalCounts = [];
    const bookFlags = [];
    let stillInBook = standardStart;
    const pos = parseFen(startFen);
    for (let i = 0; i < history.length; i++) {
      legalCounts.push(pos.legalMoves().length);
      if (stillInBook) {
        stillInBook = bookMoves(pos).some((b) => b.uci === history[i].uci);
      }
      bookFlags.push(stillInBook);
      const move = pos.legalMoves().find((m) => {
        const u = this.game.describe(m).uci;
        return u === history[i].uci;
      });
      pos.makeMove(move);
    }
    const classification = classifyGame({
      evals,
      bestMoves,
      history,
      inBook: (i) => bookFlags[i],
      legalCounts,
    });
    // Annotate the game so the exported PGN carries the review.
    classification.moves.forEach((m, i) => {
      const record = history[i];
      record.annotation = CLASSIFICATIONS[m.kind].symbol;
      const score = evals[i + 1];
      record.eval = score.mate !== undefined
        ? (score.mate === 0 ? null : `#${score.mate}`)
        : (score.cp / 100).toFixed(2);
    });
    this.review = { evals, bestMoves, classification, gameId: this.gameId, ply: this.game.ply };
    this.saveGame();
    this.renderReview();
    this.renderMoves();
    this.renderEvalBar();
    this.renderArrows();
  }

  // ---------------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------------

  saveGame() {
    saveJson('game', {
      version: 1,
      pgn: exportPgn(this.game),
      config: this.config,
      orientation: this.board.orientation,
      clock: this.clock ? this.clock.snapshot() : null,
      clockStarted: this.clockStarted,
      viewPly: this.viewPly,
      statsRecorded: !!this.game.statsRecorded,
    });
  }

  restoreGame(saved) {
    try {
      if (!saved || saved.version !== 1 || !saved.pgn) return false;
      const game = importPgn(saved.pgn);
      this.config = { ...this.config, ...saved.config, levels: { ...this.config.levels, ...(saved.config && saved.config.levels) } };
      this.gameId++;
      this.game = game;
      this.game.statsRecorded = !!saved.statsRecorded;
      this.viewPly = Math.min(saved.viewPly ?? game.ply, game.ply);
      this.analysis.enabled = this.config.mode === 'analysis';
      this.setupClock(saved.clock);
      this.board.setOrientation(saved.orientation === 'b' ? 'b' : 'w');
      if (this.clock && saved.clockStarted && !game.isOver) {
        this.clockStarted = true;
        this.clock.start(colorOf(game.turn));
      }
      this.renderAll({ animate: false });
      if (this.isAiTurn()) setTimeout(() => this.requestAiMove(), 400);
      this.runAnalysis();
      return true;
    } catch (err) {
      console.warn('Could not restore the saved game:', err);
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  renderAll({ animate = true } = {}) {
    this.renderPosition({ animate });
    this.renderPlayers();
    this.renderMaterial();
    this.renderMoves();
    this.renderStatus();
    this.renderThinking();
    this.renderControls();
    this.renderEvalBar();
    this.renderReview();
    if (this.clock) this.clock.emit();
    else this.renderClocks(null);
  }

  renderPosition({ animate = true } = {}) {
    const fen = this.game.fenAt(this.viewPly);
    const board = boardFromFen(fen);
    this.board.setPosition(board, { animate });
    const record = this.viewPly > 0 ? this.game.history[this.viewPly - 1] : null;
    if (record && this.settings.highlightLastMove) this.board.setLastMove(nameToIndex(record.from), nameToIndex(record.to));
    else this.board.setLastMove(null);
    const turn = fen.split(' ')[1];
    const inCheck = record ? record.check : this.game.ply === 0 ? this.game.inCheck() : this.displayGame().inCheck();
    this.board.setCheck(inCheck ? kingSquare(board, turn) : -1);
    this.board.setInteractive(this.canInteract());
    this.renderArrows();
  }

  renderArrows() {
    const arrows = [];
    if (this.hint && this.hint.ply === this.viewPly) {
      arrows.push({ from: this.hint.from, to: this.hint.to, color: 'hint', opacity: 0.85 });
    }
    const info = this.analysis.info;
    if (this.analysis.enabled && info && info.pv && info.pv.length && this.analysis.fen === this.game.fenAt(this.viewPly)) {
      const uci = info.pv[0];
      arrows.push({ from: nameToIndex(uci.slice(0, 2)), to: nameToIndex(uci.slice(2, 4)), color: 'engine', opacity: 0.75 });
    }
    // During a review, show what should have been played instead of an error.
    if (this.review && this.viewPly > 0 && !this.analysis.enabled) {
      const m = this.review.classification.moves[this.viewPly - 1];
      const best = this.review.bestMoves[this.viewPly - 1];
      if (m && best && ['inaccuracy', 'mistake', 'blunder'].includes(m.kind)) {
        arrows.push({ from: nameToIndex(best.slice(0, 2)), to: nameToIndex(best.slice(2, 4)), color: 'engine', opacity: 0.7 });
      }
    }
    this.board.setSystemArrows(arrows);
  }

  playerName(color) {
    const { mode, humanColor, level, levels } = this.config;
    const headers = this.game.headers || {};
    if (mode === 'ai') {
      if (color === humanColor) return { name: 'You', sub: colorWord(color) };
      const info = levelInfo(level);
      return { name: 'Computer', sub: `Level ${info.level} · ${info.name} · ~${info.rating}` };
    }
    if (mode === 'aivai') {
      const info = levelInfo(levels[color]);
      return { name: `Computer ${colorWord(color)}`, sub: `Level ${info.level} · ${info.name}` };
    }
    const header = color === 'w' ? headers.White : headers.Black;
    const name = header && header !== '?' && header !== colorWord(color) ? header : colorWord(color);
    const elo = color === 'w' ? headers.WhiteElo : headers.BlackElo;
    return { name, sub: elo ? `${colorWord(color)} · ${elo}` : mode === 'analysis' ? colorWord(color) : 'Player' };
  }

  barFor(color) {
    return color === this.board.orientation ? $('#player-bottom') : $('#player-top');
  }

  renderPlayers() {
    const turn = colorOf(parseTurn(this.game.fenAt(this.viewPly)));
    for (const color of ['w', 'b']) {
      const bar = this.barFor(color);
      const { name, sub } = this.playerName(color);
      bar.dataset.color = color;
      $('.player-name', bar).textContent = name;
      $('.player-sub', bar).textContent = sub;
      $('.player-swatch', bar).innerHTML = pieceSvg(color, 'k', this.settings.pieceStyle);
      bar.classList.toggle('to-move', !this.game.isOver && turn === color);
    }
  }

  renderMaterial() {
    const fen = this.game.fenAt(this.viewPly);
    const now = boardFromFen(fen);
    const start = boardFromFen(this.game.startFen);
    const count = (board) => {
      const c = new Array(16).fill(0);
      for (const p of board) if (p) c[p]++;
      return c;
    };
    const nowCount = count(now);
    const startCount = count(start);
    let whiteMat = 0;
    let blackMat = 0;
    const captured = { w: [], b: [] };
    for (let type = 1; type <= 5; type++) {
      whiteMat += nowCount[type] * PIECE_VALUES[type];
      blackMat += nowCount[type | 8] * PIECE_VALUES[type];
      const blackLost = Math.max(0, startCount[type | 8] - nowCount[type | 8]);
      const whiteLost = Math.max(0, startCount[type] - nowCount[type]);
      for (let i = 0; i < blackLost; i++) captured.w.push(' pnbrqk'[type]);
      for (let i = 0; i < whiteLost; i++) captured.b.push(' pnbrqk'[type]);
    }
    const diff = whiteMat - blackMat;
    for (const color of ['w', 'b']) {
      const el = $('.player-material', this.barFor(color));
      const pieces = captured[color];
      const victimColor = otherColor(color);
      const groups = [];
      for (const type of ['p', 'n', 'b', 'r', 'q']) {
        const n = pieces.filter((p) => p === type).length;
        if (!n) continue;
        const icons = Array.from({ length: n }, () => `<span class="cap-piece">${pieceSvg(victimColor, type, this.settings.pieceStyle)}</span>`).join('');
        groups.push(`<span class="cap-group">${icons}</span>`);
      }
      const advantage = color === 'w' ? diff : -diff;
      el.innerHTML = groups.join('') + (advantage > 0 ? `<span class="cap-diff">+${advantage}</span>` : '');
    }
  }

  renderClocks(state) {
    for (const color of ['w', 'b']) {
      const clockEl = $('.clock', this.barFor(color));
      if (!state) {
        clockEl.hidden = true;
        continue;
      }
      clockEl.hidden = false;
      const ms = state[color];
      $('.clock-time', clockEl).textContent = formatClockTime(ms);
      clockEl.classList.toggle('running', state.running === color);
      clockEl.classList.toggle('low', ms < 20000);
      clockEl.classList.toggle('flagged', ms <= 0);
    }
  }

  renderMoves() {
    const sheet = $('#scoresheet');
    const history = this.game.history;
    const reviewMoves = this.review ? this.review.classification.moves : null;
    const fmt = (san) => escapeHtml(this.settings.figurines ? sanToFigurine(san) : san);
    const cell = (record, index) => {
      if (!record) return '<span class="ss-move ss-empty"></span>';
      const ply = index + 1;
      const r = reviewMoves ? reviewMoves[index] : null;
      const tone = r ? CLASSIFICATIONS[r.kind].tone : '';
      const symbol = r ? CLASSIFICATIONS[r.kind].symbol : '';
      const classes = ['ss-move'];
      if (ply === this.viewPly) classes.push('current');
      if (tone) classes.push(`tone-${tone}`);
      return `<button type="button" class="${classes.join(' ')}" data-ply="${ply}" aria-label="Move ${record.moveNumber}${record.color === 'b' ? ' black' : ''}: ${escapeHtml(record.san)}">${fmt(record.san)}${symbol ? `<span class="ss-symbol">${symbol}</span>` : ''}</button>`;
    };

    const rows = [];
    let i = 0;
    if (history.length && history[0].color === 'b') {
      rows.push(`<div class="ss-row"><span class="ss-num">${history[0].moveNumber}</span>${cell(null)}${cell(history[0], 0)}</div>`);
      i = 1;
    }
    for (; i < history.length; i += 2) {
      const white = history[i];
      const black = history[i + 1];
      rows.push(`<div class="ss-row"><span class="ss-num">${white.moveNumber}</span>${cell(white, i)}${black ? cell(black, i + 1) : cell(null)}</div>`);
    }
    if (this.game.isOver) {
      rows.push(`<div class="ss-result"><strong>${this.game.result === '1/2-1/2' ? '½–½' : this.game.result.replace('-', '–')}</strong> <span>${escapeHtml(this.game.describeResult())}</span></div>`);
    }
    if (!history.length) {
      const firstMove = this.game.startsWithStandardPosition ? 'White moves first.' : `${colorWord(colorOf(this.game.turn))} to move from the set-up position.`;
      rows.push(`<p class="ss-empty-note">No moves yet. ${firstMove}</p>`);
    }
    sheet.innerHTML = rows.join('');
    const current = $('.ss-move.current', sheet);
    if (current) {
      const top = current.offsetTop - sheet.offsetTop;
      if (top < sheet.scrollTop + 8 || top > sheet.scrollTop + sheet.clientHeight - 40) {
        sheet.scrollTop = Math.max(0, top - sheet.clientHeight / 2);
      }
    } else if (this.viewPly === this.game.ply) {
      sheet.scrollTop = sheet.scrollHeight;
    }
  }

  renderStatus() {
    const { mode, humanColor } = this.config;
    const statusEl = $('#status-text');
    let text;
    if (this.game.isOver && this.isLive()) {
      text = this.game.describeResult();
    } else if (!this.isLive()) {
      const record = this.game.history[this.viewPly - 1];
      text = record
        ? `Viewing ${record.moveNumber}${record.color === 'w' ? '.' : '...'} ${this.settings.figurines ? sanToFigurine(record.san) : record.san}`
        : 'Viewing the starting position';
      if (mode !== 'analysis' && !this.game.isOver) text += '. Press End to return to the game.';
    } else if (this.paused) {
      text = 'Match paused';
    } else {
      const turn = colorOf(this.game.turn);
      const check = this.game.inCheck() ? ', in check' : '';
      if (mode === 'ai') text = turn === humanColor ? `Your move${check}` : `Computer to move${check}`;
      else text = `${colorWord(turn)} to move${check}`;
    }
    statusEl.textContent = text;
    statusEl.classList.toggle('is-over', this.game.isOver);

    const openingEl = $('#opening-name');
    const sans = this.game.sanList().slice(0, this.viewPly);
    let opening = null;
    if (this.game.startsWithStandardPosition) opening = identifyOpening(sans);
    $('.eco', openingEl).textContent = opening ? opening.eco : '';
    $('.opening-text', openingEl).textContent = opening
      ? opening.name
      : this.game.startsWithStandardPosition
        ? (sans.length ? 'Uncharted territory' : 'Starting position')
        : 'Custom position';
  }

  renderThinking() {
    const el = $('#thinking');
    el.hidden = !this.aiThinking;
    if (this.aiThinking) {
      $('#thinking-text').textContent = this.config.mode === 'aivai'
        ? `${colorWord(colorOf(this.game.turn))} is thinking`
        : 'Computer is thinking';
    }
  }

  renderControls() {
    const { mode } = this.config;
    const live = this.isLive();
    const over = this.game.isOver;
    const playing = mode === 'ai' || mode === 'pvp';
    $('#nav-first').disabled = this.viewPly === 0;
    $('#nav-prev').disabled = this.viewPly === 0;
    $('#nav-next').disabled = live;
    $('#nav-last').disabled = live;
    $('#btn-undo').disabled = mode === 'aivai' || this.game.ply === 0;
    $('#btn-hint').disabled = mode === 'aivai' || (!live && mode !== 'analysis') || (over && mode !== 'analysis') || this.aiThinking;
    $('#btn-draw').disabled = !playing || over;
    $('#btn-resign').disabled = !playing || over;
    $('#btn-draw').hidden = !playing;
    $('#btn-resign').hidden = !playing;
    const pause = $('#btn-pause');
    pause.hidden = mode !== 'aivai';
    pause.disabled = over;
    pause.setAttribute('aria-label', this.paused ? 'Resume' : 'Pause');
    pause.title = this.paused ? 'Resume the match' : 'Pause the match';
    pause.innerHTML = this.paused
      ? '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5l12 7-12 7z"/></svg>'
      : '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5v14M15 5v14"/></svg>';
    $('#move-input').disabled = !this.canInteract() && !(mode === 'analysis');
    const toggle = $('#analysis-toggle');
    toggle.checked = this.analysis.enabled;
    toggle.closest('.switch-row').classList.toggle('is-locked', !this.analysisAllowed());
    this.board.setInteractive(this.canInteract());
  }

  renderEvalBar() {
    const bar = $('#evalbar');
    let score = null;
    if (this.analysis.enabled && this.analysis.info && this.analysis.fen === this.game.fenAt(this.viewPly)) {
      score = this.analysis.info.whiteScore;
    } else if (this.review && this.review.evals[this.viewPly]) {
      score = this.review.evals[this.viewPly];
    } else if (this.config.mode === 'aivai' && this.aiInfo && this.aiInfo.whiteScore) {
      score = this.aiInfo.whiteScore;
    } else if (this.game.isOver && this.isLive() && this.game.reason === REASONS.checkmate) {
      score = { mate: 0, winner: this.game.result === RESULT_WHITE ? 'w' : 'b' };
    }
    const fill = $('.evalbar-fill', bar);
    const label = $('.evalbar-label', bar);
    bar.classList.toggle('flipped', this.board.orientation === 'b');
    if (!score) {
      bar.classList.add('idle');
      fill.style.height = '50%';
      label.textContent = '';
      bar.setAttribute('aria-valuenow', '50');
      bar.setAttribute('aria-valuetext', 'No evaluation');
      return;
    }
    bar.classList.remove('idle');
    const cp = scoreToCp(score);
    const pct = winChance(cp);
    fill.style.height = `${pct.toFixed(1)}%`;
    const text = formatScore(score);
    label.textContent = text.replace('+', '');
    label.classList.toggle('for-black', cp < 0);
    bar.setAttribute('aria-valuenow', pct.toFixed(0));
    bar.setAttribute('aria-valuetext', `Evaluation ${text}`);
  }

  renderAnalysisIdle() {
    const locked = !this.analysisAllowed();
    $('#analysis-score').textContent = '–';
    $('#analysis-depth').textContent = '–';
    $('#analysis-nodes').textContent = '–';
    $('#analysis-nps').textContent = '–';
    $('#analysis-pv').innerHTML = locked && this.config.mode === 'ai'
      ? '<span class="muted">Live analysis unlocks when this game ends. Hints are available on your turn.</span>'
      : locked && this.reviewRunning
        ? '<span class="muted">Paused while the review runs.</span>'
        : locked
          ? '<span class="muted">Live analysis is off while the computers play.</span>'
          : '<span class="muted">Turn on analysis to see the engine\'s best line.</span>';
    this.renderEvalTerms();
  }

  renderAnalysis() {
    const info = this.analysis.info;
    this.renderEvalTerms();
    if (!info) {
      $('#analysis-score').textContent = '…';
      $('#analysis-pv').innerHTML = '<span class="muted">Thinking…</span>';
      return;
    }
    $('#analysis-score').textContent = info.terminal
      ? (info.terminal === 'checkmate' ? 'Checkmate' : 'Stalemate')
      : formatScore(info.whiteScore);
    $('#analysis-depth').textContent = info.depth ? `${info.depth}${info.seldepth ? `/${info.seldepth}` : ''}` : '–';
    $('#analysis-nodes').textContent = info.nodes ? formatCount(info.nodes) : '–';
    $('#analysis-nps').textContent = info.nps ? `${formatCount(info.nps)}/s` : '–';
    $('#analysis-pv').innerHTML = this.pvHtml(this.game.fenAt(this.viewPly), info.pv || []);
  }

  // Formats a UCI principal variation as numbered SAN.
  pvHtml(fen, pv) {
    if (!pv.length) return '<span class="muted">No moves available.</span>';
    const game = new Game(fen);
    const parts = [];
    for (const uci of pv.slice(0, 14)) {
      const record = game.move(uci, { allowAfterEnd: true });
      if (!record) break;
      const san = escapeHtml(this.settings.figurines ? sanToFigurine(record.san) : record.san);
      if (record.color === 'w') parts.push(`<span class="pv-num">${record.moveNumber}.</span>`);
      else if (!parts.length) parts.push(`<span class="pv-num">${record.moveNumber}...</span>`);
      parts.push(`<span class="pv-move">${san}</span>`);
    }
    return parts.join(' ');
  }

  renderEvalTerms() {
    const game = this.displayGame();
    const explanation = explainEvaluation(game.position);
    const list = $('#eval-terms');
    const max = Math.max(50, ...explanation.terms.map((t) => Math.abs(t.value)));
    list.innerHTML = explanation.terms.map((term) => {
      const width = Math.min(50, (Math.abs(term.value) / max) * 50);
      const sign = term.value > 0 ? '+' : '';
      return `<li><span class="term-name">${escapeHtml(term.name)}</span>
        <span class="term-bar" aria-hidden="true"><span class="term-fill ${term.value < 0 ? 'neg' : 'pos'}" style="width:${width.toFixed(1)}%"></span></span>
        <span class="term-value">${sign}${(term.value / 100).toFixed(2)}</span></li>`;
    }).join('');
    $('#eval-phase').textContent = explanation.phase;
  }

  renderReview() {
    const review = this.review;
    if (this.reviewRunning) return;
    $('#review-progress').hidden = true;
    if (!review || review.gameId !== this.gameId || review.ply !== this.game.ply) {
      $('#review-start').hidden = false;
      $('#review-results').hidden = true;
      return;
    }
    $('#review-start').hidden = true;
    $('#review-results').hidden = false;
    const { white, black, moves } = review.classification;
    $('#acc-white').textContent = white.accuracy === null ? '–' : `${white.accuracy.toFixed(1)}%`;
    $('#acc-black').textContent = black.accuracy === null ? '–' : `${black.accuracy.toFixed(1)}%`;

    const rows = REVIEW_ORDER.map((kind) => {
      const c = CLASSIFICATIONS[kind];
      return `<tr class="tone-${c.tone}"><th scope="row"><span class="kind-dot" aria-hidden="true"></span>${c.label}${c.symbol ? ` <span class="kind-symbol">${c.symbol}</span>` : ''}</th><td>${white.counts[kind]}</td><td>${black.counts[kind]}</td></tr>`;
    });
    $('#review-table tbody').innerHTML = rows.join('');

    const moments = moves
      .map((m, i) => ({ m, record: this.game.history[i] }))
      .filter(({ m }) => ['blunder', 'mistake', 'inaccuracy'].includes(m.kind))
      .sort((a, b) => b.m.loss - a.m.loss)
      .slice(0, 8)
      .sort((a, b) => a.m.ply - b.m.ply);
    const momentsEl = $('#review-moments');
    if (!moments.length) {
      momentsEl.innerHTML = '<li class="muted">No inaccuracies found. A clean game.</li>';
    } else {
      momentsEl.innerHTML = moments.map(({ m, record }) => {
        const c = CLASSIFICATIONS[m.kind];
        let bestSan = '';
        if (m.best && m.best !== record.uci) {
          const g = new Game(record.fenBefore);
          const r = g.move(m.best, { allowAfterEnd: true });
          if (r) bestSan = r.san;
        }
        const label = `${record.moveNumber}${record.color === 'w' ? '.' : '...'} ${this.settings.figurines ? sanToFigurine(record.san) : record.san}${c.symbol}`;
        return `<li><button type="button" class="moment tone-${c.tone}" data-ply="${m.ply}">
          <span class="moment-move">${escapeHtml(label)}</span>
          <span class="moment-kind">${c.label}</span>
          ${bestSan ? `<span class="moment-best">Better: ${escapeHtml(this.settings.figurines ? sanToFigurine(bestSan) : bestSan)}</span>` : ''}
        </button></li>`;
      }).join('');
    }
    this.renderReviewCursor();
  }

  renderReviewCursor() {
    const review = this.review;
    if (!review || review.gameId !== this.gameId || review.ply !== this.game.ply) return;
    const points = review.evals.map((s) => winChance(scoreToCp(s)));
    const marks = review.classification.moves
      .filter((m) => ['blunder', 'mistake'].includes(m.kind))
      .map((m) => ({ ply: m.ply, kind: m.kind }));
    $('#eval-graph').innerHTML = evalGraphSvg(points, { currentPly: this.viewPly, marks });
  }

  renderStats() {
    const s = this.stats;
    const total = s.wins + s.losses + s.draws;
    $('#stats-summary').textContent = total
      ? `${s.wins} ${s.wins === 1 ? 'win' : 'wins'}, ${s.losses} ${s.losses === 1 ? 'loss' : 'losses'}, ${s.draws} ${s.draws === 1 ? 'draw' : 'draws'} across ${total} ${total === 1 ? 'game' : 'games'}.`
      : 'No games finished yet.';
    this.updateLevelRecord();
  }

  // ---------------------------------------------------------------------------
  // Settings
  // ---------------------------------------------------------------------------

  applySettings() {
    const s = this.settings;
    const theme = BOARD_THEMES.find((t) => t.id === s.boardTheme) || BOARD_THEMES[0];
    const root = document.documentElement;
    root.style.setProperty('--sq-light', theme.light);
    root.style.setProperty('--sq-dark', theme.dark);
    this.board.setPieceStyle(s.pieceStyle);
    this.board.setShowCoords(s.showCoords);
    this.board.setShowDests(s.showDests);
    this.board.setAnimationMs(ANIMATION_MS[s.animation] ?? 190);
    this.sound.enabled = s.sound;
    this.sound.volume = s.volume;
    document.body.classList.toggle('hide-evalbar', !s.showEvalBar);
    for (const btn of $$('.theme-swatch')) btn.setAttribute('aria-pressed', String(btn.dataset.theme === theme.id));
    $('#set-pieces').value = s.pieceStyle;
    $('#set-animation').value = s.animation;
    $('#set-dests').checked = s.showDests;
    $('#set-coords').checked = s.showCoords;
    $('#set-lastmove').checked = s.highlightLastMove;
    $('#set-evalbar').checked = s.showEvalBar;
    $('#set-autoqueen').checked = s.autoQueen;
    $('#set-figurines').checked = s.figurines;
    $('#set-confirm').checked = s.confirmResign;
    $('#set-sound').checked = s.sound;
    $('#set-volume').value = s.volume;
    $('#set-volume').disabled = !s.sound;
  }

  updateSetting(key, value) {
    this.settings = { ...this.settings, [key]: value };
    saveSettings(this.settings);
    this.applySettings();
    if (['pieceStyle', 'figurines', 'highlightLastMove'].includes(key)) this.renderAll({ animate: false });
    if (key === 'sound' && value) {
      this.sound.unlock();
      this.sound.play('move');
    }
  }

  buildSettingsUi() {
    $('#theme-swatches').innerHTML = BOARD_THEMES.map((t) => `
      <button type="button" class="theme-swatch" data-theme="${t.id}" aria-pressed="false" title="${t.name}">
        <span class="swatch-board" style="--l:${t.light};--d:${t.dark}" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
        <span class="swatch-name">${t.name}</span>
      </button>`).join('');
    for (const btn of $$('.theme-swatch')) {
      btn.addEventListener('click', () => this.updateSetting('boardTheme', btn.dataset.theme));
    }
    const bindCheck = (id, key) => $(id).addEventListener('change', (e) => this.updateSetting(key, e.target.checked));
    bindCheck('#set-dests', 'showDests');
    bindCheck('#set-coords', 'showCoords');
    bindCheck('#set-lastmove', 'highlightLastMove');
    bindCheck('#set-evalbar', 'showEvalBar');
    bindCheck('#set-autoqueen', 'autoQueen');
    bindCheck('#set-figurines', 'figurines');
    bindCheck('#set-confirm', 'confirmResign');
    bindCheck('#set-sound', 'sound');
    $('#set-pieces').addEventListener('change', (e) => this.updateSetting('pieceStyle', e.target.value));
    $('#set-animation').addEventListener('change', (e) => this.updateSetting('animation', e.target.value));
    $('#set-volume').addEventListener('change', (e) => {
      this.updateSetting('volume', Number(e.target.value));
      this.sound.play('move');
    });
    $('#btn-reset-stats').addEventListener('click', async () => {
      const ok = await confirmAction({
        title: 'Reset your record?',
        message: 'This clears your wins, losses and draws against the computer on this device.',
        confirmLabel: 'Reset',
        danger: true,
      });
      if (!ok) return;
      this.stats = { wins: 0, losses: 0, draws: 0, byLevel: {} };
      saveJson('stats', this.stats);
      this.renderStats();
      openDialog($('#settings-dialog'));
    });
    this.renderStats();
  }

  // ---------------------------------------------------------------------------
  // New game dialog
  // ---------------------------------------------------------------------------

  buildNewGameUi() {
    const tcSelect = $('#time-control');
    tcSelect.innerHTML = TIME_CONTROLS.map((t) => `<option value="${t.id}">${t.label}</option>`).join('')
      + '<option value="custom">Custom…</option>';
    const levelOptions = LEVELS.map((l) => `<option value="${l.level}">Level ${l.level} · ${l.name}</option>`).join('');
    $('#level-white').innerHTML = levelOptions;
    $('#level-black').innerHTML = levelOptions;

    const form = $('#new-game-form');
    form.addEventListener('change', () => this.syncNewGameForm());
    $('#level-input').addEventListener('input', () => this.syncNewGameForm());
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const config = this.readNewGameForm();
      if (!config) return;
      closeDialog($('#new-game-dialog'));
      this.startNewGame(config);
    });
  }

  openNewGameDialog() {
    const c = this.config;
    const form = $('#new-game-form');
    form.elements.mode.value = c.mode;
    form.elements.color.value = c.colorChoice || c.humanColor;
    $('#level-input').value = c.level;
    $('#level-white').value = c.levels.w;
    $('#level-black').value = c.levels.b;
    $('#time-control').value = c.timeControl;
    $('#custom-minutes').value = c.customMinutes;
    $('#custom-increment').value = c.customIncrement;
    $('#start-fen').value = c.startFen || '';
    $('#start-fen-error').hidden = true;
    this.syncNewGameForm();
    openDialog($('#new-game-dialog'));
  }

  syncNewGameForm() {
    const form = $('#new-game-form');
    const mode = form.elements.mode.value;
    $('#color-field').hidden = mode !== 'ai';
    $('#level-field').hidden = mode !== 'ai';
    $('#aivai-levels').hidden = mode !== 'aivai';
    $('#time-field').hidden = mode === 'analysis';
    $('#custom-time').hidden = $('#time-control').value !== 'custom';
    const info = levelInfo(Number($('#level-input').value));
    $('#level-label').textContent = `Level ${info.level} · ${info.name} (about ${info.rating})`;
    $('#start-game').textContent = mode === 'analysis' ? 'Open board' : mode === 'aivai' ? 'Start match' : 'Start game';
    this.updateLevelRecord();
  }

  updateLevelRecord() {
    const el = $('#level-record');
    if (!el) return;
    const level = Number($('#level-input').value);
    const rec = this.stats.byLevel[level];
    el.textContent = rec && rec.wins + rec.losses + rec.draws
      ? `Your record at this level: ${rec.wins}W ${rec.losses}L ${rec.draws}D`
      : 'You have not finished a game at this level yet.';
  }

  readNewGameForm() {
    const form = $('#new-game-form');
    const fen = $('#start-fen').value.trim();
    if (fen) {
      const check = validateFen(fen);
      if (!check.valid) {
        const err = $('#start-fen-error');
        err.textContent = `This FEN can't be used: ${check.error}`;
        err.hidden = false;
        $('#start-fen').closest('details').open = true;
        return null;
      }
    }
    return {
      mode: form.elements.mode.value,
      colorChoice: form.elements.color.value,
      humanColor: form.elements.color.value === 'b' ? 'b' : 'w',
      level: Number($('#level-input').value),
      levels: { w: Number($('#level-white').value), b: Number($('#level-black').value) },
      timeControl: $('#time-control').value,
      customMinutes: Number($('#custom-minutes').value),
      customIncrement: Number($('#custom-increment').value),
      startFen: fen,
    };
  }

  rematch() {
    closeDialog($('#game-over-dialog'));
    const config = { ...this.config };
    if (config.mode === 'ai') {
      config.colorChoice = otherColor(this.config.humanColor);
    } else if (config.mode === 'aivai') {
      config.levels = { w: config.levels.b, b: config.levels.w };
    }
    this.startNewGame(config);
  }

  // ---------------------------------------------------------------------------
  // Import / export
  // ---------------------------------------------------------------------------

  openIoDialog() {
    $('#io-fen').value = this.game.fenAt(this.viewPly);
    $('#io-pgn').value = exportPgn(this.game);
    $('#io-error').hidden = true;
    openDialog($('#io-dialog'));
  }

  showIoError(message) {
    const el = $('#io-error');
    el.textContent = message;
    el.hidden = false;
  }

  loadPgnText(text) {
    let game;
    try {
      game = importPgn(text);
    } catch (err) {
      this.showIoError(err.message);
      return;
    }
    closeDialog($('#io-dialog'));
    this.engine.cancelAll();
    this.gameId++;
    this.destroyClock();
    this.config = { ...this.config, mode: 'analysis', startFen: game.startFen === START_FEN ? '' : game.startFen };
    this.game = game;
    this.viewPly = game.ply;
    this.review = null;
    this.hint = null;
    this.aiThinking = false;
    this.paused = false;
    this.analysis.enabled = true;
    this.board.setOrientation('w');
    this.renderAll({ animate: false });
    this.saveGame();
    this.runAnalysis();
    toast(`Loaded a game of ${Math.ceil(game.ply / 2)} ${game.ply > 2 ? 'moves' : 'move'}.`);
  }

  loadFenText(fen) {
    const check = validateFen(fen);
    if (!check.valid) {
      this.showIoError(`This FEN can't be used: ${check.error}`);
      return;
    }
    closeDialog($('#io-dialog'));
    this.startNewGame({ ...this.config, mode: 'analysis', startFen: fen.trim() });
    toast('Position loaded on the analysis board.');
  }

  // ---------------------------------------------------------------------------
  // Event wiring
  // ---------------------------------------------------------------------------

  bindControls() {
    $('#btn-new-game').addEventListener('click', () => this.openNewGameDialog());
    $('#btn-import-export').addEventListener('click', () => this.openIoDialog());
    $('#btn-settings').addEventListener('click', () => openDialog($('#settings-dialog')));
    $('#btn-help').addEventListener('click', () => openDialog($('#help-dialog')));
    $('#nav-first').addEventListener('click', () => this.goTo(0));
    $('#nav-prev').addEventListener('click', () => this.goTo(this.viewPly - 1));
    $('#nav-next').addEventListener('click', () => this.goTo(this.viewPly + 1));
    $('#nav-last').addEventListener('click', () => this.goTo(this.game.ply));
    $('#btn-flip').addEventListener('click', () => this.flip());
    $('#btn-pause').addEventListener('click', () => this.togglePause());
    $('#btn-undo').addEventListener('click', () => this.takeback());
    $('#btn-hint').addEventListener('click', () => this.showHint());
    $('#btn-draw').addEventListener('click', () => this.offerDraw());
    $('#btn-resign').addEventListener('click', () => this.resign());
    $('#btn-review').addEventListener('click', () => this.startReview());
    $('#analysis-toggle').addEventListener('change', (e) => this.setAnalysisEnabled(e.target.checked));

    $('#scoresheet').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-ply]');
      if (btn) this.goTo(Number(btn.dataset.ply));
    });
    $('#review-moments').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-ply]');
      if (btn) this.goTo(Number(btn.dataset.ply));
    });
    $('#eval-graph').addEventListener('click', (e) => {
      if (!this.review) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const fraction = (e.clientX - rect.left) / rect.width;
      this.goTo(Math.round(fraction * this.game.ply));
    });
    $('#move-entry').addEventListener('submit', (e) => {
      e.preventDefault();
      this.submitTypedMove($('#move-input').value);
    });

    // Tabs
    const tabs = $$('.tab');
    const selectTab = (tab) => {
      for (const t of tabs) {
        const selected = t === tab;
        t.setAttribute('aria-selected', String(selected));
        t.tabIndex = selected ? 0 : -1;
        $(`#${t.getAttribute('aria-controls')}`).hidden = !selected;
      }
      if (tab.id === 'tab-analysis') this.renderEvalTerms();
    };
    tabs.forEach((tab, i) => {
      tab.addEventListener('click', (e) => {
        selectTab(tab);
        // A mouse click shouldn't leave focus on the tab, so the arrow keys
        // keep stepping through moves. Keyboard users keep focus as usual.
        if (e.detail > 0) tab.blur();
      });
      tab.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        e.preventDefault();
        e.stopPropagation();
        const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
        next.focus();
        selectTab(next);
      });
    });
    this.selectTab = (id) => selectTab($(id));

    // Game over dialog
    $('#go-new').addEventListener('click', () => {
      closeDialog($('#game-over-dialog'));
      this.openNewGameDialog();
    });
    $('#go-rematch').addEventListener('click', () => this.rematch());
    $('#go-review').addEventListener('click', () => {
      closeDialog($('#game-over-dialog'));
      this.selectTab('#tab-review');
      this.startReview();
    });

    // Import / export dialog
    $('#io-copy-fen').addEventListener('click', async () => {
      const ok = await copyText($('#io-fen').value, $('#io-fen'));
      toast(ok ? 'FEN copied.' : 'Select the text and copy it manually.');
    });
    $('#io-copy-pgn').addEventListener('click', async () => {
      const ok = await copyText($('#io-pgn').value, $('#io-pgn'));
      toast(ok ? 'PGN copied.' : 'Select the text and copy it manually.');
    });
    // The hosted build leaves this button out because its viewer blocks downloads.
    const download = $('#io-download-pgn');
    if (download) {
      download.addEventListener('click', () => {
        const ok = downloadText(`chess-${new Date().toISOString().slice(0, 10)}.pgn`, $('#io-pgn').value);
        if (!ok) toast('Downloading is blocked here. Copy the PGN instead.');
      });
    }
    $('#io-load-pgn').addEventListener('click', () => this.loadPgnText($('#io-pgn').value));
    $('#io-load-fen').addEventListener('click', () => this.loadFenText($('#io-fen').value));
    $('#io-file').addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      try {
        $('#io-pgn').value = await readFileAsText(file);
        $('#io-error').hidden = true;
      } catch {
        this.showIoError('That file could not be read.');
      }
      e.target.value = '';
    });

    // Paste a PGN or FEN anywhere on the page (outside inputs) to load it.
    document.addEventListener('paste', (e) => {
      const target = e.target;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      if ($('dialog[open]')) return;
      const text = (e.clipboardData && e.clipboardData.getData('text')) || '';
      if (!text.trim()) return;
      if (validateFen(text.trim()).valid) {
        this.startNewGame({ ...this.config, mode: 'analysis', startFen: text.trim() });
        toast('Pasted position opened on the analysis board.');
      } else if (/\d\.\s*[a-hNBRQKO]/.test(text) || /^\s*\[/.test(text)) {
        this.loadPgnText(text);
      }
    });
  }

  bindKeyboard() {
    document.addEventListener('keydown', (e) => {
      if (e.defaultPrevented) return;
      const tag = (e.target && e.target.tagName) || '';
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) || e.target.isContentEditable) return;
      if ($('dialog[open]')) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      switch (e.key) {
        case 'ArrowLeft': this.goTo(this.viewPly - 1); break;
        case 'ArrowRight': this.goTo(this.viewPly + 1); break;
        case 'ArrowUp':
        case 'Home': this.goTo(0); break;
        case 'ArrowDown':
        case 'End': this.goTo(this.game.ply); break;
        case 'f': case 'F': this.flip(); break;
        case 'n': case 'N': this.openNewGameDialog(); break;
        case 'u': case 'U': this.takeback(); break;
        case 'h': case 'H': this.showHint(); break;
        case 'a': case 'A': this.setAnalysisEnabled(!this.analysis.enabled); break;
        case '/':
          $('#move-input').focus();
          break;
        default:
          return;
      }
      e.preventDefault();
    });
  }
}

function parseTurn(fen) {
  return fen.split(' ')[1] === 'b' ? 1 : 0;
}
