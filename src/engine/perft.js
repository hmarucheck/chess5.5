// Performance test: counts leaf nodes of the legal move tree to a fixed depth.
// Comparing against published numbers is the standard way to prove a move
// generator correct, including every castling, en passant and promotion edge.

import { moveToUci } from './constants.js';

export function perft(pos, depth) {
  if (depth === 0) return 1;
  const moves = pos.generateMoves([]);
  let nodes = 0;
  for (let i = 0; i < moves.length; i++) {
    if (!pos.makeMove(moves[i])) continue;
    nodes += depth === 1 ? 1 : perft(pos, depth - 1);
    pos.unmakeMove();
  }
  return nodes;
}

// Per-root-move breakdown, useful when hunting a move generator bug.
export function divide(pos, depth) {
  const result = {};
  for (const move of pos.legalMoves()) {
    pos.makeMove(move);
    result[moveToUci(move)] = perft(pos, depth - 1);
    pos.unmakeMove();
  }
  return result;
}
