// The AI: evaluation symmetry, static exchange evaluation, tactics,
// strength levels, the opening book and time management.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFen } from '../src/engine/fen.js';
import { START_FEN, moveToUci } from '../src/engine/constants.js';
import { evaluate, evaluateWhite, explainEvaluation } from '../src/ai/evaluate.js';
import { Search, see, scoreToObject, MATE } from '../src/ai/search.js';
import { Engine, LEVELS, levelInfo, allocateTime, positionFromMoves } from '../src/ai/engine.js';
import { getBook, bookMoves, pickBookMove, BOOK_LINES } from '../src/ai/book.js';
import { TranspositionTable, TT_EXACT } from '../src/ai/tt.js';

// Mirrors a FEN vertically and swaps colours.
function mirrorFen(fen) {
  const [board, turn, castling, ep, half, full] = fen.split(' ');
  const swap = (s) => s.replace(/[a-z]/gi, (c) => (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase()));
  const rows = board.split('/').reverse().map(swap);
  const castle = castling === '-' ? '-' : swap(castling).split('').sort((a, b) => {
    const order = 'KQkq';
    return order.indexOf(a) - order.indexOf(b);
  }).join('');
  const mirroredEp = ep === '-' ? '-' : ep[0] + (9 - Number(ep[1]));
  return [rows.join('/'), turn === 'w' ? 'b' : 'w', castle, mirroredEp, half, full].join(' ');
}

// Seeded random numbers so level tests are repeatable.
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const EVAL_POSITIONS = [
  START_FEN,
  'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
  'r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10',
  '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1',
  '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1',
  '8/8/4k3/8/8/4K3/4Q3/8 w - - 0 1',
  '2r3k1/p4p2/3Rp2p/1p2P1pK/8/1P4P1/P3Q2P/1q6 b - - 0 1',
];

test('evaluation is colour-symmetric', () => {
  for (const fen of EVAL_POSITIONS) {
    const a = parseFen(fen);
    const b = parseFen(mirrorFen(fen));
    assert.equal(evaluateWhite(a) + evaluateWhite(b), 0, `white-view eval of ${fen}`);
    assert.equal(evaluate(a), evaluate(b), `side-to-move eval of ${fen}`);
  }
});

test('the start position is roughly balanced and extra material counts', () => {
  const start = evaluateWhite(parseFen(START_FEN));
  assert.ok(Math.abs(start) < 40, `start eval ${start}`);
  const queenUp = evaluateWhite(parseFen('rnb1kbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'));
  assert.ok(queenUp > 800, `queen up eval ${queenUp}`);
});

test('drawish endgames are scaled towards zero', () => {
  const knightOnly = evaluateWhite(parseFen('8/8/4k3/8/8/4KN2/8/8 w - - 0 1'));
  assert.ok(Math.abs(knightOnly) < 60, `K+N v K should look drawn, got ${knightOnly}`);
  const rookUp = evaluateWhite(parseFen('8/8/4k3/8/8/4KR2/8/8 w - - 0 1'));
  assert.ok(rookUp > 400, `K+R v K should look winning, got ${rookUp}`);
});

test('evaluation breakdown adds up to the total', () => {
  const pos = parseFen(EVAL_POSITIONS[2]);
  const { total, terms, phase } = explainEvaluation(pos);
  assert.equal(total, evaluateWhite(pos));
  assert.equal(terms.length, 5);
  assert.ok(phase >= 0 && phase <= 100);
  const sum = terms.reduce((a, t) => a + t.value, 0);
  assert.ok(Math.abs(sum - total) <= 3, `terms sum ${sum} vs total ${total}`);
});

test('static exchange evaluation', () => {
  const find = (pos, uci) => pos.legalMoves().find((m) => moveToUci(m) === uci);
  // Pawn takes an undefended knight: +320.
  let pos = parseFen('4k3/8/8/3n4/4P3/8/8/4K3 w - - 0 1');
  assert.equal(see(pos, find(pos, 'e4d5')), 320);
  // Queen takes a pawn defended by a pawn: loses the queen for a pawn.
  pos = parseFen('4k3/8/2p5/3p4/8/8/3Q4/4K3 w - - 0 1');
  assert.equal(see(pos, find(pos, 'd2d5')), 100 - 900);
  // Doubled rooks against doubled rooks: the x-rayed rook behind wins a rook.
  pos = parseFen('3r3k/3r4/8/8/8/8/3R4/3RK3 w - - 0 1');
  assert.equal(see(pos, find(pos, 'd2d7')), 500);
  // Same, but the black king also guards d7: the exchange nets nothing.
  pos = parseFen('3rk3/3r4/8/8/8/8/3R4/3RK3 w - - 0 1');
  assert.equal(see(pos, find(pos, 'd2d7')), 0);
  // Knight takes a pawn defended by a pawn: loses the knight for a pawn.
  pos = parseFen('4k3/8/4p3/3p4/8/2N5/8/4K3 w - - 0 1');
  assert.equal(see(pos, find(pos, 'c3d5')), 100 - 320);
});

test('finds mate in one', () => {
  const engine = new Engine({ hashMb: 4 });
  const result = engine.analyze({ fen: '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1', timeMs: 2000 });
  assert.equal(result.move, 'd1d8');
  assert.deepEqual(result.score, { mate: 1 });
});

test('finds mate in two', () => {
  const engine = new Engine({ hashMb: 4 });
  const result = engine.analyze({ fen: 'r2qkb1r/pp2nppp/3p4/2pNN1B1/2BnP3/3P4/PPP2PPP/R2bK2R w KQkq - 1 1', timeMs: 3000 });
  assert.equal(result.move, 'd5f6');
  assert.deepEqual(result.score, { mate: 2 });
});

test('finds a back-rank mate for black', () => {
  const engine = new Engine({ hashMb: 4 });
  const result = engine.analyze({ fen: '4r1k1/5ppp/8/8/8/8/2q2PPP/4R1K1 b - - 0 1', timeMs: 3000 });
  assert.equal(result.move, 'e8e1');
  assert.deepEqual(result.score, { mate: 1 });
  assert.deepEqual(result.whiteScore, { mate: -1 });
});

test('wins a hanging queen', () => {
  const engine = new Engine({ hashMb: 4 });
  const result = engine.analyze({ fen: 'rnb1kbnr/pppp1ppp/8/4p1q1/3P4/8/PPP1PPPP/RNBQKBNR w KQkq - 0 1', timeMs: 1500 });
  assert.equal(result.move, 'c1g5');
});

test('reports mate and stalemate for terminal positions', () => {
  const engine = new Engine({ hashMb: 4 });
  const mated = engine.analyze({ fen: 'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3' });
  assert.equal(mated.terminal, 'checkmate');
  assert.equal(mated.move, null);
  assert.equal(mated.whiteScore.winner, 'b');
  const stale = engine.analyze({ fen: '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1' });
  assert.equal(stale.terminal, 'stalemate');
});

test('search respects the node limit and returns a legal move', () => {
  const search = new Search({ hashMb: 4 });
  const pos = parseFen(EVAL_POSITIONS[1]);
  const result = search.search(pos, { nodes: 20000 });
  assert.ok(result.bestMove);
  assert.ok(pos.legalMoves().includes(result.bestMove));
  assert.ok(result.nodes < 40000);
  // The position is unchanged after searching.
  assert.equal(pos.undoStack.length, 0);
});

test('search reports progressively deeper info', () => {
  const search = new Search({ hashMb: 4 });
  const depths = [];
  search.search(parseFen(START_FEN), { depth: 5, onInfo: (info) => depths.push(info.depth) });
  assert.deepEqual(depths, [1, 2, 3, 4, 5]);
});

test('repetition is scored as a draw inside the search', () => {
  // White is a queen down but can force perpetual check.
  const pos = positionFromMoves('6k1/5ppp/8/8/8/8/q4PPP/3Q2K1 w - - 0 1', []);
  const search = new Search({ hashMb: 4 });
  const result = search.search(pos, { timeMs: 1500 });
  assert.ok(result.score > -800, `white should not be lost by a queen (${result.score})`);
});

test('every level returns a legal move quickly', () => {
  const engine = new Engine({ hashMb: 4, random: seeded(7) });
  const fen = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3';
  for (const { level } of LEVELS) {
    const started = Date.now();
    const result = engine.play({ fen, moves: [], level, useBook: false, clock: { remainingMs: 5000, incrementMs: 0 } });
    const pos = parseFen(fen);
    assert.ok(pos.legalMoves().some((m) => moveToUci(m) === result.move), `level ${level} played ${result.move}`);
    assert.ok(Date.now() - started < 2500, `level ${level} took too long`);
  }
});

test('weak levels still take a free queen most of the time at level 5', () => {
  const engine = new Engine({ hashMb: 4, random: seeded(11) });
  const fen = 'rnb1kbnr/pppp1ppp/8/4p1q1/3P4/8/PPP1PPPP/RNBQKBNR w KQkq - 0 1';
  let taken = 0;
  for (let i = 0; i < 10; i++) {
    if (engine.play({ fen, moves: [], level: 5, useBook: false }).move === 'c1g5') taken++;
  }
  assert.ok(taken >= 8, `took the queen ${taken}/10 times`);
});

test('level presets are ordered by strength', () => {
  assert.equal(LEVELS.length, 10);
  for (let i = 1; i < LEVELS.length; i++) assert.ok(LEVELS[i].rating > LEVELS[i - 1].rating);
  assert.equal(levelInfo(0).level, 1);
  assert.equal(levelInfo(99).level, 10);
});

test('every opening book line is legal and the book is used', () => {
  const book = getBook();
  assert.ok(book.size > 100);
  assert.ok(BOOK_LINES.length >= 40);
  const start = bookMoves(parseFen(START_FEN)).map((m) => m.uci).sort();
  assert.ok(start.includes('e2e4') && start.includes('d2d4') && start.includes('c2c4'));
  const pick = pickBookMove(parseFen(START_FEN), seeded(3));
  assert.ok(start.includes(pick));
  assert.equal(pickBookMove(parseFen('8/8/4k3/8/8/4K3/4Q3/8 w - - 0 1')), null);
  const engine = new Engine({ hashMb: 4, random: seeded(5) });
  const result = engine.play({ fen: START_FEN, moves: [], level: 8 });
  assert.equal(result.source, 'book');
});

test('positionFromMoves replays and rejects illegal history', () => {
  const pos = positionFromMoves(START_FEN, ['e2e4', 'e7e5', 'g1f3']);
  assert.equal(pos.turn, 1);
  assert.equal(pos.historyLo.length, 3);
  assert.throws(() => positionFromMoves(START_FEN, ['e2e5']), /Illegal move/);
});

test('time allocation stays within the clock', () => {
  assert.ok(allocateTime(60000, 0, 0) <= 12000);
  assert.ok(allocateTime(60000, 0, 0) >= 1000);
  assert.ok(allocateTime(1000, 0, 80) <= 200);
  assert.ok(allocateTime(10000, 2000, 30) > allocateTime(10000, 0, 30));
  assert.equal(allocateTime(10, 0, 0), 50);
});

test('score conversion to mate distance', () => {
  assert.deepEqual(scoreToObject(MATE - 1), { mate: 1 });
  assert.deepEqual(scoreToObject(MATE - 3), { mate: 2 });
  assert.deepEqual(scoreToObject(-(MATE - 2)), { mate: -1 });
  assert.deepEqual(scoreToObject(35), { cp: 35 });
});

test('transposition table stores and probes', () => {
  const tt = new TranspositionTable(1);
  tt.store(12345, 678, 5, TT_EXACT, 42, 99);
  const slot = tt.probe(12345, 678);
  assert.ok(slot >= 0);
  assert.equal(tt.scores[slot], 42);
  assert.equal(tt.moves[slot], 99);
  assert.equal(tt.probe(12345, 679), -1);
  tt.clear();
  assert.equal(tt.probe(12345, 678), -1);
});
