// A small opening book so the engine plays varied, sensible openings instead
// of computing the same first moves every game. Lines are plain SAN; they are
// replayed once at start-up into a map from position to candidate moves.

import { parseFen, toFen, fenKey } from '../engine/fen.js';
import { START_FEN, moveToUci } from '../engine/constants.js';
import { sanToMove } from '../engine/san.js';

export const BOOK_LINES = [
  // Open games
  'e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 d6 c3 O-O h3',
  'e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Nxe4 d4 b5 Bb3 d5 dxe5 Be6',
  'e4 e5 Nf3 Nc6 Bb5 Nf6 O-O Nxe4 d4 Nd6 Bxc6 dxc6 dxe5 Nf5 Qxd8+ Kxd8',
  'e4 e5 Nf3 Nc6 Bb5 a6 Bxc6 dxc6 O-O f6 d4 exd4 Nxd4 c5',
  'e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d3 d6 O-O O-O Re1 a6',
  'e4 e5 Nf3 Nc6 Bc4 Nf6 d3 Be7 O-O O-O Re1 d6 c3',
  'e4 e5 Nf3 Nc6 Bc4 Nf6 Ng5 d5 exd5 Na5 Bb5+ c6 dxc6 bxc6 Be2 h6',
  'e4 e5 Nf3 Nc6 d4 exd4 Nxd4 Nf6 Nxc6 bxc6 e5 Qe7 Qe2 Nd5 c4',
  'e4 e5 Nf3 Nc6 d4 exd4 Nxd4 Bc5 Be3 Qf6 c3 Nge7 Bc4',
  'e4 e5 Nf3 Nc6 Nc3 Nf6 Bb5 Bb4 O-O O-O d3 d6 Bg5',
  'e4 e5 Nf3 Nf6 Nxe5 d6 Nf3 Nxe4 d4 d5 Bd3 Nc6 O-O Be7',
  'e4 e5 Nf3 d6 d4 Nf6 Nc3 Nbd7 Bc4 Be7 O-O O-O',
  'e4 e5 f4 exf4 Nf3 d6 d4 g5 h4 g4 Ng1',
  'e4 e5 Nc3 Nf6 f4 d5 fxe5 Nxe4 Nf3 Be7',
  // Sicilian
  'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 Be3 e5 Nb3 Be6 f3 Be7',
  'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 g6 Be3 Bg7 f3 O-O Qd2 Nc6',
  'e4 c5 Nf3 Nc6 d4 cxd4 Nxd4 Nf6 Nc3 e5 Ndb5 d6 Bg5 a6 Na3 b5',
  'e4 c5 Nf3 e6 d4 cxd4 Nxd4 Nc6 Nc3 Qc7 Be3 a6 Bd3',
  'e4 c5 Nf3 e6 d4 cxd4 Nxd4 a6 Bd3 Nf6 O-O Qc7',
  'e4 c5 Nf3 d6 Bb5+ Bd7 Bxd7+ Qxd7 O-O Nc6 c3 Nf6',
  'e4 c5 Nc3 Nc6 g3 g6 Bg2 Bg7 d3 d6 f4 e6',
  'e4 c5 c3 Nf6 e5 Nd5 d4 cxd4 Nf3 Nc6 cxd4 d6',
  // French, Caro-Kann and others
  'e4 e6 d4 d5 Nc3 Nf6 Bg5 Be7 e5 Nfd7 Bxe7 Qxe7 f4 O-O',
  'e4 e6 d4 d5 Nc3 Bb4 e5 c5 a3 Bxc3+ bxc3 Ne7',
  'e4 e6 d4 d5 Nd2 c5 exd5 Qxd5 Ngf3 cxd4 Bc4 Qd6 O-O Nf6',
  'e4 e6 d4 d5 e5 c5 c3 Nc6 Nf3 Qb6 a3 c4',
  'e4 c6 d4 d5 Nc3 dxe4 Nxe4 Bf5 Ng3 Bg6 h4 h6 Nf3 Nd7 h5 Bh7',
  'e4 c6 d4 d5 e5 Bf5 Nf3 e6 Be2 c5 Be3',
  'e4 c6 d4 d5 exd5 cxd5 c4 Nf6 Nc3 e6 Nf3 Be7',
  'e4 d5 exd5 Qxd5 Nc3 Qa5 d4 Nf6 Nf3 c6 Bc4 Bf5',
  'e4 Nf6 e5 Nd5 d4 d6 Nf3 Bg4 Be2 e6 O-O Be7',
  'e4 g6 d4 Bg7 Nc3 d6 Be3 a6 Qd2 b5',
  'e4 d6 d4 Nf6 Nc3 g6 Nf3 Bg7 Be2 O-O O-O c6',
  // Queen's pawn
  'd4 d5 c4 e6 Nc3 Nf6 Bg5 Be7 e3 O-O Nf3 h6 Bh4 b6',
  'd4 d5 c4 e6 Nc3 Nf6 cxd5 exd5 Bg5 c6 e3 Be7 Bd3',
  'd4 d5 c4 e6 Nc3 c5 cxd5 exd5 Nf3 Nc6 g3 Nf6 Bg2 Be7',
  'd4 d5 c4 c6 Nf3 Nf6 Nc3 dxc4 a4 Bf5 e3 e6 Bxc4 Bb4 O-O',
  'd4 d5 c4 c6 Nf3 Nf6 e3 Bf5 Nc3 e6 Nh4 Bg6',
  'd4 d5 c4 dxc4 Nf3 Nf6 e3 e6 Bxc4 c5 O-O a6',
  'd4 Nf6 c4 g6 Nc3 Bg7 e4 d6 Nf3 O-O Be2 e5 O-O Nc6 d5 Ne7',
  'd4 Nf6 c4 g6 Nc3 d5 cxd5 Nxd5 e4 Nxc3 bxc3 Bg7 Nf3 c5',
  'd4 Nf6 c4 e6 Nc3 Bb4 e3 O-O Bd3 d5 Nf3 c5 O-O',
  'd4 Nf6 c4 e6 Nc3 Bb4 Qc2 O-O a3 Bxc3+ Qxc3 b6',
  'd4 Nf6 c4 e6 Nf3 b6 g3 Ba6 b3 Bb4+ Bd2 Be7',
  'd4 Nf6 c4 e6 g3 d5 Bg2 Be7 Nf3 O-O O-O dxc4',
  'd4 Nf6 c4 c5 d5 e6 Nc3 exd5 cxd5 d6 e4 g6 Nf3 Bg7',
  'd4 Nf6 c4 c5 d5 b5 cxb5 a6 bxa6 g6 Nc3 Bxa6',
  'd4 Nf6 Nf3 g6 Bf4 Bg7 e3 O-O Be2 d6',
  'd4 d5 Bf4 Nf6 e3 c5 c3 Nc6 Nd2 e6 Ngf3 Bd6',
  'd4 d5 Nf3 Nf6 e3 e6 Bd3 c5 b3 Nc6 O-O Bd6 Bb2',
  'd4 f5 g3 Nf6 Bg2 g6 Nf3 Bg7 O-O O-O c4 d6',
  // Flank openings
  'c4 e5 Nc3 Nf6 Nf3 Nc6 g3 d5 cxd5 Nxd5 Bg2 Nb6 O-O Be7',
  'c4 c5 Nc3 Nc6 g3 g6 Bg2 Bg7 Nf3 e6 O-O Nge7',
  'c4 Nf6 Nc3 e6 e4 d5 e5 d4 exf6 dxc3 bxc3 Qxf6',
  'c4 e6 Nc3 d5 d4 Nf6 Nf3 Be7 Bf4 O-O',
  'Nf3 d5 g3 Nf6 Bg2 c6 O-O Bg4 d3 Nbd7',
  'Nf3 Nf6 c4 g6 Nc3 Bg7 e4 d6 d4 O-O Be2 e5',
  'Nf3 d5 d4 Nf6 c4 e6 Nc3 Be7 Bg5 O-O',
  'g3 d5 Bg2 Nf6 Nf3 c6 O-O Bg4',
];

let bookMap = null;

// Builds (once) a map: position key -> Map(uci -> weight).
export function getBook() {
  if (bookMap) return bookMap;
  bookMap = new Map();
  for (const line of BOOK_LINES) {
    const pos = parseFen(START_FEN);
    for (const san of line.split(/\s+/)) {
      const move = sanToMove(pos, san);
      if (!move) throw new Error(`Opening book line has an illegal move "${san}": ${line}`);
      const key = fenKey(toFen(pos));
      if (!bookMap.has(key)) bookMap.set(key, new Map());
      const entry = bookMap.get(key);
      const uci = moveToUci(move);
      entry.set(uci, (entry.get(uci) || 0) + 1);
      pos.makeMove(move);
    }
  }
  return bookMap;
}

// Returns the candidate book moves for a position as [{uci, weight}].
export function bookMoves(pos) {
  const entry = getBook().get(fenKey(toFen(pos)));
  if (!entry) return [];
  return [...entry.entries()].map(([uci, weight]) => ({ uci, weight }));
}

// Picks a weighted random book move, or null when out of book.
export function pickBookMove(pos, random = Math.random) {
  const moves = bookMoves(pos);
  if (!moves.length) return null;
  const total = moves.reduce((sum, m) => sum + m.weight, 0);
  let roll = random() * total;
  for (const m of moves) {
    roll -= m.weight;
    if (roll < 0) return m.uci;
  }
  return moves[moves.length - 1].uci;
}
