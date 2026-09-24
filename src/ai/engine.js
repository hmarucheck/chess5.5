// Engine front door: turns requests ("play a move at level 6", "analyse this
// position", "review this game") into searches. It runs inside a Web Worker
// in the browser, but has no browser dependencies, so tests and the
// single-threaded fallback call it directly.

import { WHITE, moveToUci } from '../engine/constants.js';
import { parseFen } from '../engine/fen.js';
import { Search, MATE_BOUND, scoreToObject } from './search.js';
import { pickBookMove } from './book.js';

// Playing strength presets. Levels 1-5 score every root move shallowly and
// pick with random noise, which produces believable human-like mistakes.
// Levels 6-10 run the full search with growing time budgets.
export const LEVELS = [
  { level: 1, name: 'Beginner', rating: 400, depth: 1, noise: 260, bookChance: 0 },
  { level: 2, name: 'Novice', rating: 700, depth: 1, noise: 150, bookChance: 0.2 },
  { level: 3, name: 'Casual', rating: 1000, depth: 2, noise: 90, bookChance: 0.5 },
  { level: 4, name: 'Club player', rating: 1250, depth: 2, noise: 55, bookChance: 0.7 },
  { level: 5, name: 'Intermediate', rating: 1450, depth: 3, noise: 30, bookChance: 0.85 },
  { level: 6, name: 'Advanced', rating: 1650, timeMs: 300, maxDepth: 5, noise: 0, bookChance: 1 },
  { level: 7, name: 'Expert', rating: 1850, timeMs: 700, maxDepth: 8, noise: 0, bookChance: 1 },
  { level: 8, name: 'Candidate master', rating: 2000, timeMs: 1500, noise: 0, bookChance: 1 },
  { level: 9, name: 'Master', rating: 2150, timeMs: 3000, noise: 0, bookChance: 1 },
  { level: 10, name: 'Full strength', rating: 2300, timeMs: 6000, noise: 0, bookChance: 1 },
];

export function levelInfo(level) {
  return LEVELS[Math.max(1, Math.min(10, level)) - 1];
}

// Rebuilds a Position from a start FEN plus the UCI moves played since, so
// the search knows the game history for repetition detection.
export function positionFromMoves(fen, uciMoves = []) {
  const pos = parseFen(fen);
  for (const uci of uciMoves) {
    const move = pos.legalMoves().find((m) => moveToUci(m) === uci);
    if (!move) throw new Error(`Illegal move ${uci} while replaying game.`);
    pos.makeMove(move);
  }
  return pos;
}

// Box-Muller standard normal sample.
function gaussian(random) {
  let u = 0;
  let v = 0;
  while (u === 0) u = random();
  while (v === 0) v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// Budget for one move from the clock: a slice of remaining time plus most
// of the increment, never more than a fifth of what is left.
export function allocateTime(remainingMs, incrementMs = 0, movesPlayed = 0) {
  const movesToGo = Math.max(20, 45 - Math.floor(movesPlayed / 2));
  let budget = remainingMs / movesToGo + incrementMs * 0.75;
  budget = Math.min(budget, remainingMs * 0.2);
  return Math.max(50, Math.floor(budget));
}

// Score from White's point of view, for eval bars and graphs.
export function whiteScore(score, turn) {
  return turn === WHITE ? score : -score;
}

export class Engine {
  constructor({ hashMb = 32, random = Math.random } = {}) {
    this.search = new Search({ hashMb });
    this.random = random;
  }

  newGame() {
    this.search.reset();
  }

  // Chooses a move to play. Request fields:
  //   fen, moves   the game so far
  //   level        1..10
  //   clock        optional {remainingMs, incrementMs}
  //   useBook      default true
  play(request, onInfo = null) {
    const pos = positionFromMoves(request.fen, request.moves);
    const preset = levelInfo(request.level || 6);
    const turn = pos.turn;
    const legal = pos.legalMoves();
    if (!legal.length) return { move: null, source: 'none' };

    if (request.useBook !== false && this.random() < preset.bookChance) {
      const book = pickBookMove(pos, this.random);
      if (book) return { move: book, source: 'book', score: null, pv: [book] };
    }

    if (preset.noise > 0) {
      const scored = this.search.scoreRootMoves(pos, preset.depth);
      // Always take a forced mate if the preset can see it; beginners still
      // occasionally miss one.
      let best = scored[0];
      let bestNoisy = -Infinity;
      for (const entry of scored) {
        const noisy = entry.score + gaussian(this.random) * preset.noise;
        if (noisy > bestNoisy) {
          bestNoisy = noisy;
          best = entry;
        }
      }
      if (scored[0].score > MATE_BOUND && preset.level >= 3) best = scored[0];
      const result = {
        move: moveToUci(best.move),
        source: 'search',
        score: scoreToObject(best.score),
        whiteScore: scoreToObject(whiteScore(best.score, turn)),
        depth: preset.depth,
        pv: [moveToUci(best.move)],
      };
      if (onInfo) onInfo({ depth: preset.depth, score: result.score, whiteScore: result.whiteScore, pv: result.pv, nodes: this.search.nodes, nps: 0, timeMs: 0 });
      return result;
    }

    let timeMs = preset.timeMs;
    if (request.clock && request.clock.remainingMs > 0) {
      timeMs = Math.min(timeMs, allocateTime(request.clock.remainingMs, request.clock.incrementMs, request.moves ? request.moves.length : 0));
    }
    return this.runSearch(pos, { timeMs, depth: preset.maxDepth }, onInfo);
  }

  // Analysis: searches for `timeMs` (or to `depth`) and reports progress.
  analyze(request, onInfo = null) {
    const pos = positionFromMoves(request.fen, request.moves);
    if (!pos.legalMoves().length) {
      const mated = pos.inCheck();
      return {
        move: null,
        score: mated ? { mate: 0 } : { cp: 0 },
        whiteScore: mated ? { mate: 0, winner: pos.turn === WHITE ? 'b' : 'w' } : { cp: 0 },
        pv: [],
        depth: 0,
        terminal: mated ? 'checkmate' : 'stalemate',
      };
    }
    return this.runSearch(pos, { timeMs: request.timeMs || 2000, depth: request.depth }, onInfo);
  }

  runSearch(pos, limits, onInfo) {
    const turn = pos.turn;
    const result = this.search.search(pos, {
      timeMs: limits.timeMs,
      depth: limits.depth,
      nodes: limits.nodes,
      onInfo: onInfo
        ? (info) => onInfo({ ...info, whiteScore: scoreToObject(whiteScore(info.rawScore, turn)) })
        : null,
    });
    return {
      move: result.bestMove ? moveToUci(result.bestMove) : null,
      source: 'search',
      score: scoreToObject(result.score),
      whiteScore: scoreToObject(whiteScore(result.score, turn)),
      rawWhiteScore: whiteScore(result.score, turn),
      depth: result.depth,
      pv: result.pv.map(moveToUci),
      nodes: result.nodes,
      timeMs: result.timeMs,
    };
  }

  // Evaluates every position of a game for the review screen. `positions`
  // is a list of {fen, moves}; progress(index, analysis) fires after each.
  review(request, progress = null) {
    const results = [];
    const timeMs = request.timeMsPerMove || 250;
    const depth = request.depth || 64;
    request.positions.forEach((entry, index) => {
      const analysis = this.analyze({ fen: entry.fen, moves: entry.moves, timeMs, depth });
      results.push(analysis);
      if (progress) progress(index, analysis);
    });
    return results;
  }
}
