// Game review maths and the chess clock.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreToCp, winChance, moveAccuracy, classifyGame, evalGraphSvg, formatScore } from '../src/ui/review.js';
import { ChessClock, formatClockTime, TIME_CONTROLS } from '../src/ui/clock.js';
import { Game } from '../src/engine/game.js';
import { Engine } from '../src/ai/engine.js';

test('mate scores map to large centipawn values, nearer mates larger', () => {
  assert.equal(scoreToCp({ cp: 42 }), 42);
  assert.ok(scoreToCp({ mate: 1 }) > scoreToCp({ mate: 5 }));
  assert.ok(scoreToCp({ mate: -1 }) < scoreToCp({ mate: -5 }));
  assert.equal(scoreToCp({ mate: 0, winner: 'w' }), 10000);
  assert.equal(scoreToCp({ mate: 0, winner: 'b' }), -10000);
  assert.equal(scoreToCp(null), 0);
});

test('winning chances are symmetric and bounded', () => {
  assert.equal(winChance(0), 50);
  assert.ok(Math.abs(winChance(300) + winChance(-300) - 100) < 1e-9);
  assert.ok(winChance(100000) <= 100 && winChance(100000) > 99);
  assert.ok(winChance(-100000) >= 0 && winChance(-100000) < 1);
});

test('move accuracy falls as winning chances are lost', () => {
  assert.equal(moveAccuracy(60, 60), 100);
  assert.ok(moveAccuracy(60, 55) > moveAccuracy(60, 40));
  assert.ok(moveAccuracy(80, 10) < 10);
  assert.equal(moveAccuracy(40, 70), 100, 'gaining never costs accuracy');
});

test('classifyGame labels a blunder and a best move', () => {
  const game = Game.fromMoves(['e4', 'e5', 'Qh5', 'Ke7', 'Qxe5#']);
  // evals[i] is the score after i plies; the mate appears only after Ke7.
  const evals = [{ cp: 20 }, { cp: 30 }, { cp: 10 }, { cp: -20 }, { mate: 1 }, { mate: 0, winner: 'w' }];
  const bestMoves = ['e2e4', 'e7e5', 'g1f3', 'g7g6', 'h5e5', null];
  const result = classifyGame({ evals, bestMoves, history: game.history, inBook: (i) => i < 2 });
  const kinds = result.moves.map((m) => m.kind);
  assert.deepEqual(kinds.slice(0, 2), ['book', 'book']);
  assert.equal(kinds[3], 'blunder', 'Ke7 walks into mate');
  assert.equal(kinds[4], 'best');
  assert.ok(result.black.accuracy < result.white.accuracy);
  assert.equal(result.white.counts.best, 1);
  assert.equal(result.black.counts.blunder, 1);
});

test('forced moves are not held against the player', () => {
  const game = Game.fromMoves(['e4', 'f5', 'Qh5+', 'g6']);
  const evals = [{ cp: 20 }, { cp: 90 }, { cp: 80 }, { cp: 600 }, { cp: 600 }];
  const result = classifyGame({ evals, bestMoves: [null, null, null, null], history: game.history, legalCounts: [20, 20, 30, 1] });
  assert.equal(result.moves[3].kind, 'forced');
});

test('evaluation graph markup', () => {
  const svg = evalGraphSvg([50, 55, 40, 90], { currentPly: 2, marks: [{ ply: 2, kind: 'blunder' }] });
  assert.match(svg, /<svg[^>]+viewBox="0 0 600 120"/);
  assert.match(svg, /class="eg-line"/);
  assert.match(svg, /eg-blunder/);
  assert.match(svg, /eg-cursor/);
  assert.match(evalGraphSvg([50]), /<svg/);
});

test('score formatting', () => {
  assert.equal(formatScore({ cp: 125 }), '+1.25');
  assert.equal(formatScore({ cp: -40 }), '-0.40');
  assert.equal(formatScore({ cp: 0 }), '0.00');
  assert.equal(formatScore({ mate: 3 }), '#3');
  assert.equal(formatScore({ mate: -2 }), '#-2');
  assert.equal(formatScore({ mate: 0, winner: 'b' }), '0-1');
  assert.equal(formatScore(null), '–');
});

test('engine review produces one analysis per position', () => {
  const engine = new Engine({ hashMb: 4 });
  const game = Game.fromMoves(['e4', 'e5', 'Qh5', 'Ke7', 'Qxe5#']);
  const positions = [];
  for (let i = 0; i <= game.ply; i++) positions.push({ fen: game.startFen, moves: game.uciList().slice(0, i) });
  const progress = [];
  const results = engine.review({ positions, timeMsPerMove: 60 }, (i) => progress.push(i));
  assert.equal(results.length, 6);
  assert.deepEqual(progress, [0, 1, 2, 3, 4, 5]);
  assert.equal(results[5].terminal, 'checkmate');
  assert.equal(results[4].move, 'h5e5');
});

test('clock formatting', () => {
  assert.equal(formatClockTime(300000), '5:00');
  assert.equal(formatClockTime(61000), '1:01');
  assert.equal(formatClockTime(3723000), '1:02:03');
  assert.equal(formatClockTime(19950), '0:19.9');
  assert.equal(formatClockTime(0), '0:00.0');
  assert.equal(formatClockTime(-500), '0:00.0');
});

test('clock presses add the increment and switch sides', () => {
  const ticks = [];
  const clock = new ChessClock({ initialMs: 60000, incrementMs: 2000, onTick: (s) => ticks.push(s) });
  clock.start('w');
  assert.equal(clock.running, 'w');
  clock.press('w');
  assert.equal(clock.running, 'b');
  assert.ok(clock.get('w') > 61900 && clock.get('w') <= 62000, `white has ${clock.get('w')}`);
  clock.press('b');
  assert.equal(clock.running, 'w');
  clock.stop();
  assert.equal(clock.running, null);
  assert.ok(ticks.length > 0);
  const snap = clock.snapshot();
  assert.equal(snap.incrementMs, 2000);
  clock.destroy();
});

test('clock flags when time runs out', async () => {
  let flagged = null;
  const clock = new ChessClock({ initialMs: 150, onFlag: (c) => { flagged = c; } });
  clock.start('b');
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(flagged, 'b');
  assert.equal(clock.get('b'), 0);
  clock.destroy();
});

test('time control presets are sane', () => {
  assert.equal(TIME_CONTROLS[0].id, 'none');
  for (const tc of TIME_CONTROLS.slice(1)) {
    assert.ok(tc.initial > 0);
    assert.ok(tc.increment >= 0);
    assert.match(tc.label, /\d+\+\d+/);
  }
});
