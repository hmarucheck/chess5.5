// Move generator correctness against the standard perft reference positions
// (https://www.chessprogramming.org/Perft_Results).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFen } from '../src/engine/fen.js';
import { perft, divide } from '../src/engine/perft.js';
import { START_FEN } from '../src/engine/constants.js';

const CASES = [
  { name: 'start position', fen: START_FEN, counts: [20, 400, 8902, 197281] },
  { name: 'kiwipete', fen: 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', counts: [48, 2039, 97862] },
  { name: 'position 3 (en passant and pins)', fen: '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', counts: [14, 191, 2812, 43238] },
  { name: 'position 4 (promotions)', fen: 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', counts: [6, 264, 9467] },
  { name: 'position 4 mirrored', fen: 'r2q1rk1/pP1p2pp/Q4n2/bbp1p3/Np6/1B3NBn/pPPP1PPP/R3K2R b KQ - 0 1', counts: [6, 264, 9467] },
  { name: 'position 5', fen: 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8', counts: [44, 1486, 62379] },
  { name: 'position 6', fen: 'r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10', counts: [46, 2079, 89890] },
];

for (const { name, fen, counts } of CASES) {
  test(`perft: ${name}`, () => {
    const pos = parseFen(fen);
    counts.forEach((expected, i) => {
      assert.equal(perft(pos, i + 1), expected, `depth ${i + 1}`);
    });
  });
}

test('perft leaves the position and its hash untouched', () => {
  const pos = parseFen(CASES[1].fen);
  const before = { lo: pos.hashLo, hi: pos.hashHi, board: Array.from(pos.board) };
  perft(pos, 3);
  assert.equal(pos.hashLo, before.lo);
  assert.equal(pos.hashHi, before.hi);
  assert.deepEqual(Array.from(pos.board), before.board);
});

test('divide sums to the perft total', () => {
  const pos = parseFen(START_FEN);
  const parts = divide(pos, 3);
  assert.equal(Object.keys(parts).length, 20);
  assert.equal(Object.values(parts).reduce((a, b) => a + b, 0), 8902);
  assert.equal(parts.e2e4, 600);
});
