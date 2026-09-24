// SAN generation and parsing, PGN export and import, opening names.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, RESULT_BLACK, RESULT_WHITE, RESULT_NONE, REASONS } from '../src/engine/game.js';
import { parseFen } from '../src/engine/fen.js';
import { moveToSan, sanToMove, sanToFigurine } from '../src/engine/san.js';
import { exportPgn, importPgn, tokenizeMovetext, parsePgnHeaders, splitPgnGames, formatClock, PgnError } from '../src/engine/pgn.js';
import { identifyOpening, OPENINGS } from '../src/engine/openings.js';
import { START_FEN, moveToUci } from '../src/engine/constants.js';

function sanOf(fen, uci) {
  const pos = parseFen(fen);
  const move = pos.legalMoves().find((m) => moveToUci(m) === uci);
  assert.ok(move, `${uci} should be legal`);
  return moveToSan(pos, move);
}

test('SAN disambiguates by file, rank, or both', () => {
  // Rooks on a1 and h1 can both reach d1: use the file.
  assert.equal(sanOf('4k3/8/8/8/8/8/4K3/R6R w - - 0 1', 'a1d1'), 'Rad1');
  // Rooks on a1 and a5 (same file: use rank).
  assert.equal(sanOf('4k3/8/8/R7/8/8/8/R3K3 w - - 0 1', 'a1a3'), 'R1a3');
  // Three queens: needs the full square.
  assert.equal(sanOf('7k/8/8/8/Q1Q5/8/Q7/4K3 w - - 0 1', 'a4b3'), 'Qa4b3');
  assert.equal(sanOf('4k3/8/8/8/8/2N3N1/8/4K3 w - - 0 1', 'c3e2'), 'Nce2');
  // The e2 knight is pinned, so Nd4 needs no disambiguation.
  assert.equal(sanOf('4k3/4r3/8/8/8/1N6/4N3/4K3 w - - 0 1', 'b3d4'), 'Nd4');
});

test('SAN for captures, castling, checks and mates', () => {
  assert.equal(sanOf('rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 2', 'e4d5'), 'exd5');
  assert.equal(sanOf('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', 'e1c1'), 'O-O-O');
  assert.equal(sanOf('r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 1', 'e8g8'), 'O-O');
  assert.equal(sanOf('4k3/8/8/8/8/8/8/R3K3 w - - 0 1', 'a1a8'), 'Ra8+');
  assert.equal(sanOf('6k1/5ppp/8/8/8/8/8/R3K3 w - - 0 1', 'a1a8'), 'Ra8#');
  assert.equal(sanOf('rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2', 'd1h5'), 'Qh5');
});

test('SAN parsing accepts common spellings', () => {
  const pos = parseFen('r3k2r/1P6/8/8/8/8/8/R3K2R w KQkq - 0 1');
  const expect = (text, uci) => {
    const move = sanToMove(pos, text);
    assert.ok(move, `${text} should parse`);
    assert.equal(moveToUci(move), uci, text);
  };
  expect('O-O', 'e1g1');
  expect('0-0', 'e1g1');
  expect('O-O-O', 'e1c1');
  expect('0-0-0', 'e1c1');
  expect('bxa8=Q', 'b7a8q');
  expect('bxa8Q', 'b7a8q');
  expect('bxa8=n', 'b7a8n');
  expect('b8=R+', 'b7b8r');
  expect('b7b8q', 'b7b8q');
  expect('b7b8', 'b7b8q');
  expect('Kd2', 'e1d2');
  expect('Rd1', 'a1d1');
  expect('Ra1d1', 'a1d1');
  expect('Ke1-d2', 'e1d2');
  assert.equal(sanToMove(pos, 'Qd4'), 0);
  assert.equal(sanToMove(pos, 'e9'), 0);
  assert.equal(sanToMove(pos, ''), 0);
});

test('SAN parsing handles captures written without x', () => {
  const pos = parseFen('rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 2');
  assert.equal(moveToUci(sanToMove(pos, 'exd5')), 'e4d5');
  assert.equal(moveToUci(sanToMove(pos, 'ed5')), 'e4d5');
});

test('figurine notation', () => {
  assert.equal(sanToFigurine('Nf3'), '♘f3');
  assert.equal(sanToFigurine('exd8=Q+'), 'exd8=♕+');
  assert.equal(sanToFigurine('O-O'), 'O-O');
});

test('PGN export has the seven tag roster and wrapped movetext', () => {
  const game = Game.fromMoves('e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 d6 c3 O-O h3 Nb8 d4 Nbd7'.split(' '));
  game.headers = { White: 'Alice', Black: 'Bob' };
  const pgn = exportPgn(game, { Event: 'Club night' });
  assert.match(pgn, /^\[Event "Club night"\]\n\[Site "[^"]+"\]\n\[Date "\d{4}\.\d\d\.\d\d"\]/);
  assert.match(pgn, /\[White "Alice"\]/);
  assert.match(pgn, /\[Result "\*"\]/);
  assert.match(pgn, /1\. e4 e5 2\. Nf3 Nc6 3\. Bb5 a6/);
  for (const line of pgn.split('\n')) assert.ok(line.length <= 80, `line too long: ${line}`);
  assert.ok(pgn.trimEnd().endsWith('*'));
});

test('PGN export of a custom position includes SetUp and FEN, and black-first numbering', () => {
  const game = new Game('4k3/8/8/8/8/8/4P3/4K3 b - - 0 12');
  game.move('Kd7');
  game.move('e4');
  const pgn = exportPgn(game);
  assert.match(pgn, /\[SetUp "1"\]/);
  assert.match(pgn, /\[FEN "4k3\/8\/8\/8\/8\/8\/4P3\/4K3 b - - 0 12"\]/);
  assert.match(pgn, /12\.\.\. Kd7 13\. e4/);
});

test('PGN round trip preserves moves, result and start position', () => {
  const game = Game.fromMoves('f3 e5 g4 Qh4#'.split(' '));
  const again = importPgn(exportPgn(game));
  assert.deepEqual(again.sanList(), ['f3', 'e5', 'g4', 'Qh4#']);
  assert.equal(again.result, RESULT_BLACK);
  assert.equal(again.reason, REASONS.checkmate);

  const custom = new Game('4k3/8/8/8/8/8/4P3/4K3 b - - 0 12');
  custom.move('Kd7');
  const back = importPgn(exportPgn(custom));
  assert.equal(back.startFen, custom.startFen);
  assert.equal(back.fen, custom.fen);
});

test('PGN import skips comments, variations, NAGs and annotations', () => {
  const pgn = `[Event "Test"]
[White "A"]
[Black "B"]
[Result "1-0"]

1. e4 {Best by test} e5 (1... c5 2. Nf3 (2. c3) d6) 2. Nf3 $1 Nc6!? 3. Bb5 a6?! ; a line comment
4. Ba4 Nf6 5. O-O Be7 {[%clk 0:04:32]} 1-0`;
  const game = importPgn(pgn);
  assert.deepEqual(game.sanList(), ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O', 'Be7']);
  assert.equal(game.history[0].comment, 'Best by test');
  assert.equal(game.history[3].annotation, '!?');
  assert.equal(game.history[9].clock, 272000);
  assert.equal(game.result, RESULT_WHITE);
  assert.equal(game.reason, REASONS.resignation);
  assert.equal(game.headers.White, 'A');
});

test('PGN import reports the illegal move', () => {
  assert.throws(() => importPgn('1. e4 e5 2. Ke3'), (err) => err instanceof PgnError && /Move 2\. Ke3/.test(err.message));
  assert.throws(() => importPgn('1. e4 e5 2. Nf3 Ke7 3. Nxe9'), /Nxe9/);
  assert.throws(() => importPgn('   '), PgnError);
});

test('PGN import of the first game in a multi-game file', () => {
  const text = `[Event "One"]\n\n1. e4 e5 *\n\n[Event "Two"]\n\n1. d4 d5 *\n`;
  assert.equal(splitPgnGames(text).length, 2);
  const game = importPgn(text);
  assert.deepEqual(game.sanList(), ['e4', 'e5']);
  assert.equal(game.result, RESULT_NONE);
});

test('movetext tokenizer and header parser', () => {
  const tokens = tokenizeMovetext('1.e4 e5 2.Nf3 {x} 2...Nc6 3.Bb5 1/2-1/2');
  assert.deepEqual(tokens.filter((t) => t.type === 'move').map((t) => t.value), ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5']);
  assert.equal(tokens.at(-1).value, '1/2-1/2');
  const headers = parsePgnHeaders('[White "Carlsen, Magnus"]\n[Black "O\\"Brien"]');
  assert.equal(headers.White, 'Carlsen, Magnus');
  assert.equal(headers.Black, 'O"Brien');
});

test('clock formatting for PGN', () => {
  assert.equal(formatClock(272000), '0:04:32');
  assert.equal(formatClock(3723000), '1:02:03');
});

test('every named opening line is legal and identifiable', () => {
  for (const [eco, name, moves] of OPENINGS) {
    if (!moves) continue;
    const game = Game.fromMoves(moves.split(' '));
    const found = identifyOpening(game.sanList());
    assert.ok(found, `${name} should be identified`);
    assert.equal(found.eco, eco, `${moves} -> ${found.name}`);
  }
});

test('opening identification picks the most specific line', () => {
  const game = Game.fromMoves('e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 Be3'.split(' '));
  assert.equal(identifyOpening(game.sanList()).name, 'Sicilian Defence: Najdorf Variation');
  assert.equal(identifyOpening([]), null);
  assert.equal(identifyOpening(Game.fromMoves(['a3']).sanList()), null);
  assert.equal(new Game().fen, START_FEN);
});
