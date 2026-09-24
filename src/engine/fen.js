// Forsyth-Edwards Notation: parsing, validation and generation.

import {
  WHITE, BLACK, PAWN, KING,
  CASTLE_WK, CASTLE_WQ, CASTLE_BK, CASTLE_BQ,
  SQ_A1, SQ_E1, SQ_H1, SQ_A8, SQ_E8, SQ_H8, ROOK,
  makeSquare, parseSquare, squareName, charToPiece, pieceToChar, pieceType, pieceColor, makePiece, rankOf,
} from './constants.js';
import { Position } from './position.js';

export class FenError extends Error {
  constructor(message) {
    super(message);
    this.name = 'FenError';
  }
}

export function parseFen(fen) {
  if (typeof fen !== 'string') throw new FenError('FEN must be a string.');
  const parts = fen.trim().split(/\s+/);
  if (parts.length < 1 || !parts[0]) throw new FenError('FEN is empty.');
  if (parts.length > 6) throw new FenError('FEN has too many fields.');

  // Tolerate FENs that omit the trailing fields.
  const [placement, turn = 'w', castling = '-', ep = '-', halfmove = '0', fullmove = '1'] = parts;

  const pos = new Position();
  const rows = placement.split('/');
  if (rows.length !== 8) throw new FenError(`Board must have 8 ranks, found ${rows.length}.`);

  const kingCount = [0, 0];
  for (let i = 0; i < 8; i++) {
    const rank = 7 - i;
    let file = 0;
    for (const ch of rows[i]) {
      if (ch >= '1' && ch <= '8') {
        file += Number(ch);
      } else {
        const piece = charToPiece(ch);
        if (!piece) throw new FenError(`Unknown piece "${ch}" on rank ${rank + 1}.`);
        if (file > 7) throw new FenError(`Rank ${rank + 1} has more than 8 squares.`);
        if (pieceType(piece) === PAWN && (rank === 0 || rank === 7)) {
          throw new FenError(`Pawns cannot stand on rank ${rank + 1}.`);
        }
        if (pieceType(piece) === KING) kingCount[pieceColor(piece)]++;
        pos.put(makeSquare(file, rank), piece);
        file++;
      }
    }
    if (file !== 8) throw new FenError(`Rank ${rank + 1} describes ${file} squares instead of 8.`);
  }
  if (kingCount[WHITE] !== 1) throw new FenError('White must have exactly one king.');
  if (kingCount[BLACK] !== 1) throw new FenError('Black must have exactly one king.');

  if (turn !== 'w' && turn !== 'b') throw new FenError(`Side to move must be "w" or "b", got "${turn}".`);
  pos.turn = turn === 'w' ? WHITE : BLACK;

  if (castling !== '-') {
    for (const ch of castling) {
      const bit = { K: CASTLE_WK, Q: CASTLE_WQ, k: CASTLE_BK, q: CASTLE_BQ }[ch];
      if (!bit) throw new FenError(`Invalid castling flag "${ch}".`);
      pos.castling |= bit;
    }
  }
  pos.castling = sanitizeCastling(pos);

  if (ep !== '-') {
    const square = parseSquare(ep);
    if (square < 0) throw new FenError(`Invalid en passant square "${ep}".`);
    const expectedRank = pos.turn === WHITE ? 5 : 2;
    if (rankOf(square) !== expectedRank) throw new FenError(`En passant square ${ep} is on the wrong rank.`);
    // Only keep it if a pawn really just made a double step past it.
    const pawnSq = pos.turn === WHITE ? square - 16 : square + 16;
    if (pos.board[pawnSq] === makePiece(pos.turn ^ 1, PAWN) && !pos.board[square]) pos.ep = square;
  }

  const hm = Number(halfmove);
  const fm = Number(fullmove);
  if (!Number.isInteger(hm) || hm < 0) throw new FenError(`Invalid halfmove clock "${halfmove}".`);
  if (!Number.isInteger(fm) || fm < 0) throw new FenError(`Invalid fullmove number "${fullmove}".`);
  pos.halfmove = hm;
  // Many tools write a fullmove number of 0; treat it as 1.
  pos.fullmove = Math.max(1, fm);

  // The side that just moved cannot still be in check.
  if (pos.isAttacked(pos.kings[pos.turn ^ 1], pos.turn)) {
    throw new FenError(`${pos.turn === WHITE ? 'Black' : 'White'} is in check but it is not their move.`);
  }

  pos.refreshHash();
  return pos;
}

// Drops castling rights whose king or rook is no longer on its home square.
function sanitizeCastling(pos) {
  let rights = pos.castling;
  const b = pos.board;
  if (b[SQ_E1] !== makePiece(WHITE, KING)) rights &= ~(CASTLE_WK | CASTLE_WQ);
  if (b[SQ_H1] !== makePiece(WHITE, ROOK)) rights &= ~CASTLE_WK;
  if (b[SQ_A1] !== makePiece(WHITE, ROOK)) rights &= ~CASTLE_WQ;
  if (b[SQ_E8] !== makePiece(BLACK, KING)) rights &= ~(CASTLE_BK | CASTLE_BQ);
  if (b[SQ_H8] !== makePiece(BLACK, ROOK)) rights &= ~CASTLE_BK;
  if (b[SQ_A8] !== makePiece(BLACK, ROOK)) rights &= ~CASTLE_BQ;
  return rights;
}

export function toFen(pos) {
  const rows = [];
  for (let rank = 7; rank >= 0; rank--) {
    let row = '';
    let empty = 0;
    for (let file = 0; file < 8; file++) {
      const p = pos.board[makeSquare(file, rank)];
      if (!p) {
        empty++;
      } else {
        if (empty) { row += empty; empty = 0; }
        row += pieceToChar(p);
      }
    }
    if (empty) row += empty;
    rows.push(row);
  }
  let castling = '';
  if (pos.castling & CASTLE_WK) castling += 'K';
  if (pos.castling & CASTLE_WQ) castling += 'Q';
  if (pos.castling & CASTLE_BK) castling += 'k';
  if (pos.castling & CASTLE_BQ) castling += 'q';
  return [
    rows.join('/'),
    pos.turn === WHITE ? 'w' : 'b',
    castling || '-',
    pos.ep >= 0 ? squareName(pos.ep) : '-',
    pos.halfmove,
    pos.fullmove,
  ].join(' ');
}

// The first four FEN fields identify a position for book lookup and repetition.
export function fenKey(fen) {
  return fen.split(' ').slice(0, 4).join(' ');
}

export function validateFen(fen) {
  try {
    parseFen(fen);
    return { valid: true, error: null };
  } catch (err) {
    return { valid: false, error: err.message };
  }
}
