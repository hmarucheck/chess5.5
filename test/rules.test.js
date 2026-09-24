// Game rules: results, draw rules, castling, en passant, hashing and FEN.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, RESULT_WHITE, RESULT_BLACK, RESULT_DRAW, RESULT_NONE, REASONS } from '../src/engine/game.js';
import { parseFen, toFen, validateFen, FenError, fenKey } from '../src/engine/fen.js';
import { START_FEN, moveToUci } from '../src/engine/constants.js';

function play(game, moves) {
  for (const m of moves.split(/\s+/).filter(Boolean)) {
    assert.ok(game.move(m), `expected ${m} to be legal in ${game.fen}`);
  }
  return game;
}

test("fool's mate ends the game with a black win", () => {
  const game = play(new Game(), 'f3 e5 g4 Qh4#');
  assert.equal(game.result, RESULT_BLACK);
  assert.equal(game.reason, REASONS.checkmate);
  assert.equal(game.history.at(-1).san, 'Qh4#');
  assert.equal(game.move('a3'), null, 'no moves after mate');
});

test("scholar's mate ends the game with a white win", () => {
  const game = play(new Game(), 'e4 e5 Qh5 Nc6 Bc4 Nf6 Qxf7#');
  assert.equal(game.result, RESULT_WHITE);
  assert.match(game.describeResult(), /Checkmate/);
});

test('stalemate is a draw', () => {
  // White blunders a won position into stalemate.
  const game = new Game('7k/8/4Q1K1/8/8/8/8/8 w - - 0 1');
  play(game, 'Qf7');
  assert.equal(game.reason, REASONS.stalemate);
  const stale = new Game('7k/8/6QK/8/8/8/8/8 b - - 0 1');
  assert.equal(stale.result, RESULT_DRAW);
  assert.equal(stale.reason, REASONS.stalemate);
});

test('insufficient material is detected', () => {
  const cases = [
    ['8/8/4k3/8/8/4K3/8/8 w - - 0 1', true],
    ['8/8/4k3/8/8/4KN2/8/8 w - - 0 1', true],
    ['8/8/4k3/8/8/4KB2/8/8 w - - 0 1', true],
    ['8/8/3bk3/8/8/4KB2/8/8 w - - 0 1', false], // d6 and f3: opposite colours
    ['8/8/2b1k3/8/8/4KB2/8/8 w - - 0 1', true], // c6 and f3: both light squares
    ['8/8/4k3/8/8/3NKN2/8/8 w - - 0 1', false],
    ['8/8/4k3/8/8/4KR2/8/8 w - - 0 1', false],
    ['8/8/4k3/8/8/4KP2/8/8 w - - 0 1', false],
  ];
  for (const [fen, expected] of cases) {
    assert.equal(parseFen(fen).isInsufficientMaterial(), expected, fen);
  }
  const game = new Game('8/8/4k3/8/8/4K3/8/8 w - - 0 1');
  assert.equal(game.result, RESULT_DRAW);
  assert.equal(game.reason, REASONS.insufficient);
});

test('capturing the last piece triggers insufficient material', () => {
  const game = new Game('8/8/4k3/8/3r4/4K3/8/8 w - - 0 1');
  assert.equal(game.result, RESULT_NONE);
  play(game, 'Kxd4');
  assert.equal(game.reason, REASONS.insufficient);
});

test('threefold repetition is a draw', () => {
  const game = play(new Game(), 'Nf3 Nf6 Ng1 Ng8 Nf3 Nf6 Ng1');
  assert.equal(game.result, RESULT_NONE);
  play(game, 'Ng8');
  assert.equal(game.result, RESULT_DRAW);
  assert.equal(game.reason, REASONS.threefold);
});

test('fifty-move rule is a draw', () => {
  const game = new Game('8/8/4k3/8/8/4K3/8/R7 w - - 99 80');
  assert.equal(game.result, RESULT_NONE);
  play(game, 'Ra2');
  assert.equal(game.reason, REASONS.fiftyMove);
});

test('a pawn move resets the fifty-move counter', () => {
  const game = new Game('8/8/4k3/8/8/4K3/P7/R7 w - - 99 80');
  play(game, 'a3');
  assert.equal(game.position.halfmove, 0);
  assert.equal(game.result, RESULT_NONE);
});

test('castling both ways, and rights are lost when king or rook move', () => {
  const game = new Game('r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1');
  const sans = game.moveObjects('e1').map((m) => m.to).sort();
  assert.deepEqual(sans, ['c1', 'd1', 'f1', 'g1']);
  play(game, 'O-O');
  assert.equal(game.pieceAt('g1').type, 'k');
  assert.equal(game.pieceAt('f1').type, 'r');
  assert.match(game.fen, / b kq /);
  play(game, 'Rb8');
  assert.match(game.fen, / w k /);
  play(game, 'Kh1 O-O');
  assert.equal(game.pieceAt('g8').type, 'k');
  assert.match(game.fen, / w - /);
});

test('cannot castle out of, through, or into check', () => {
  // Rook on e-file gives check.
  let game = new Game('4r1k1/8/8/8/8/8/8/R3K2R w KQ - 0 1');
  assert.ok(!game.moveObjects('e1').some((m) => m.castle));
  // Rook attacks f1: kingside blocked, queenside fine.
  game = new Game('5rk1/8/8/8/8/8/8/R3K2R w KQ - 0 1');
  const castles = game.moveObjects('e1').filter((m) => m.castle).map((m) => m.to);
  assert.deepEqual(castles, ['c1']);
  // Rook attacks b1 only: queenside castling is still legal (b1 is not crossed by the king).
  game = new Game('1r4k1/8/8/8/8/8/8/R3K2R w KQ - 0 1');
  assert.deepEqual(game.moveObjects('e1').filter((m) => m.castle).map((m) => m.to).sort(), ['c1', 'g1']);
});

test('capturing a rook on its home square removes that castling right', () => {
  const game = new Game('r3k2r/8/8/8/8/8/6b1/R3K2R b KQkq - 0 1');
  play(game, 'Bxh1');
  assert.match(game.fen, / w Qkq /);
});

test('en passant capture works and only right after the double step', () => {
  const game = play(new Game(), 'e4 a6 e5 d5');
  const ep = game.moveObjects('e5').find((m) => m.enPassant);
  assert.ok(ep, 'exd6 e.p. available');
  assert.equal(ep.to, 'd6');
  play(game, 'exd6');
  assert.equal(game.pieceAt('d5'), null);
  assert.equal(game.history.at(-1).captured, 'p');

  const later = play(new Game(), 'e4 a6 e5 d5 Nf3 a5');
  assert.ok(!later.moveObjects('e5').some((m) => m.enPassant));
});

test('en passant that would expose the king is illegal', () => {
  // Classic horizontal pin: capturing would leave the king on a5 in check from h5.
  const game = new Game('8/8/8/K2pP2r/8/8/8/7k w - d6 0 1');
  assert.ok(!game.moveObjects('e5').some((m) => m.enPassant));
});

test('promotion to every piece, and SAN for it', () => {
  const game = new Game('8/P6k/8/8/8/8/8/K7 w - - 0 1');
  const promos = game.moveObjects('a7').map((m) => m.promotion).sort();
  assert.deepEqual(promos, ['b', 'n', 'q', 'r']);
  assert.ok(game.isPromotion('a7', 'a8'));
  const record = game.move({ from: 'a7', to: 'a8', promotion: 'n' });
  assert.equal(record.san, 'a8=N');
  assert.equal(game.pieceAt('a8').type, 'n');
  game.undo();
  assert.equal(game.move('a8=Q+').san, 'a8=Q');
});

test('undo restores the exact previous state', () => {
  const game = new Game();
  const fens = [game.fen];
  for (const m of 'e4 d5 exd5 Qxd5 Nc3 Qa5 d4 c6 Nf3 Bf5 Bc4 e6 O-O'.split(' ')) {
    play(game, m);
    fens.push(game.fen);
  }
  for (let i = fens.length - 2; i >= 0; i--) {
    game.undo();
    assert.equal(game.fen, fens[i]);
    const [lo, hi] = game.position.computeHash();
    assert.equal(game.position.hashLo, lo);
    assert.equal(game.position.hashHi, hi);
  }
});

test('incremental hash always equals a from-scratch hash', () => {
  const pos = parseFen('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1');
  let rng = 12345;
  const rand = (n) => {
    rng = (rng * 1103515245 + 12345) & 0x7fffffff;
    return rng % n;
  };
  for (let game = 0; game < 30; game++) {
    let plies = 0;
    for (; plies < 40; plies++) {
      const moves = pos.legalMoves();
      if (!moves.length) break;
      pos.makeMove(moves[rand(moves.length)]);
      const [lo, hi] = pos.computeHash();
      assert.equal(pos.hashLo, lo, `hash lo mismatch after ${moveToUci(pos.lastMove())}`);
      assert.equal(pos.hashHi, hi);
    }
    while (plies-- > 0) pos.unmakeMove();
  }
});

test('transposed positions share a hash; unusable en passant is ignored', () => {
  const a = parseFen(START_FEN);
  const b = parseFen(START_FEN);
  const seq = (pos, moves) => moves.split(' ').forEach((m) => {
    const move = pos.legalMoves().find((x) => moveToUci(x) === m);
    pos.makeMove(move);
  });
  seq(a, 'g1f3 g8f6 b1c3 b8c6');
  seq(b, 'b1c3 b8c6 g1f3 g8f6');
  assert.equal(a.hashLo, b.hashLo);
  assert.equal(a.hashHi, b.hashHi);
  // e2e4 sets an ep square no black pawn can use: same hash as without it.
  const c = parseFen('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1');
  const d = parseFen('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1');
  assert.equal(c.hashLo, d.hashLo);
});

test('FEN round trip', () => {
  const fens = [
    START_FEN,
    'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
    'rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6 0 3',
    '8/8/8/8/8/8/8/K6k b - - 42 99',
  ];
  for (const fen of fens) assert.equal(toFen(parseFen(fen)), fen);
});

test('FEN parsing tolerates missing fields and rejects bad input', () => {
  assert.equal(toFen(parseFen('8/8/8/8/8/8/8/K6k')), '8/8/8/8/8/8/8/K6k w - - 0 1');
  const bad = [
    '',
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP w KQkq - 0 1',
    'rnbqkbnr/pppppppp/9/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQ1BNR w KQkq - 0 1',
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR x KQkq - 0 1',
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNX w KQkq - 0 1',
    'Pnbqkbnr/pppppppp/8/8/8/8/1PPPPPPP/RNBQKBNR w KQkq - 0 1',
    '4k3/8/8/8/8/8/8/4K2r b - - 0 1', // side not to move is in check... white king attacked by black rook, black to move
  ];
  for (const fen of bad) {
    assert.throws(() => parseFen(fen), FenError, fen);
    assert.equal(validateFen(fen).valid, false);
  }
});

test('castling rights without the pieces are dropped', () => {
  assert.match(toFen(parseFen('4k3/8/8/8/8/8/8/4K3 w KQkq - 0 1')), / w - /);
  assert.match(toFen(parseFen('r3k3/8/8/8/8/8/8/4K2R w KQkq - 0 1')), / w Kq /);
});

test('fenKey ignores the move counters', () => {
  assert.equal(fenKey(START_FEN), 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -');
});

test('resignation, timeout and draw agreement', () => {
  let game = play(new Game(), 'e4 e5');
  game.resign(0);
  assert.equal(game.result, RESULT_BLACK);
  assert.equal(game.move('Nf3'), null);

  game = play(new Game(), 'e4 e5');
  game.timeout(1);
  assert.equal(game.result, RESULT_WHITE);
  assert.equal(game.reason, REASONS.timeout);

  // Flag falls, but the opponent only has a king: draw.
  game = new Game('8/8/4k3/8/8/4K3/4Q3/8 w - - 0 1');
  game.timeout(0);
  assert.equal(game.result, RESULT_DRAW);
  assert.equal(game.reason, REASONS.timeoutDraw);

  game = play(new Game(), 'd4 d5');
  game.agreeDraw();
  assert.equal(game.result, RESULT_DRAW);
});

test('undo after checkmate clears the result', () => {
  const game = play(new Game(), 'f3 e5 g4 Qh4#');
  game.undo();
  assert.equal(game.result, RESULT_NONE);
  assert.equal(game.turn, 1);
});

test('material summary counts captures and promotions', () => {
  const game = play(new Game(), 'e4 d5 exd5 Qxd5 Nc3 Qxg2');
  const { captured, advantage } = game.materialSummary();
  assert.deepEqual(captured.w.sort(), ['p']);
  assert.deepEqual(captured.b.sort(), ['p', 'p']);
  assert.equal(advantage, -1);
});

test('fenAt returns every intermediate position', () => {
  const game = play(new Game(), 'e4 e5 Nf3');
  assert.equal(game.fenAt(0), START_FEN);
  assert.equal(game.fenAt(1), 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1');
  assert.equal(game.fenAt(3), game.fen);
});
