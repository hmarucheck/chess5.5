// Core constants and tiny helpers shared by the rules engine, the AI and the UI.
//
// The board uses the classic 0x88 layout: a square index is (rank << 4) | file,
// with rank 0 being White's back rank. Any index with a bit of 0x88 set lies off
// the board, which makes move generation bounds checks a single AND.

export const WHITE = 0;
export const BLACK = 1;

export const EMPTY = 0;
export const PAWN = 1;
export const KNIGHT = 2;
export const BISHOP = 3;
export const ROOK = 4;
export const QUEEN = 5;
export const KING = 6;

// A piece code is its type, with bit 3 set for black pieces (so 1..6 and 9..14).
export const BLACK_BIT = 8;

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export const FILES = 'abcdefgh';
export const RANKS = '12345678';

export const PIECE_LETTERS = ' pnbrqk';
export const PIECE_NAMES = ['', 'pawn', 'knight', 'bishop', 'rook', 'queen', 'king'];

// Castling right bits.
export const CASTLE_WK = 1;
export const CASTLE_WQ = 2;
export const CASTLE_BK = 4;
export const CASTLE_BQ = 8;

// Move flag bits.
export const FLAG_CAPTURE = 1;
export const FLAG_EP = 2;
export const FLAG_CASTLE = 4;
export const FLAG_DOUBLE = 8;
export const FLAG_PROMO = 16;

export const KNIGHT_OFFSETS = [33, 31, 18, 14, -33, -31, -18, -14];
export const BISHOP_OFFSETS = [15, 17, -15, -17];
export const ROOK_OFFSETS = [1, -1, 16, -16];
export const KING_OFFSETS = [1, -1, 16, -16, 15, 17, -15, -17];

export const SQ_A1 = 0x00;
export const SQ_B1 = 0x01;
export const SQ_C1 = 0x02;
export const SQ_D1 = 0x03;
export const SQ_E1 = 0x04;
export const SQ_F1 = 0x05;
export const SQ_G1 = 0x06;
export const SQ_H1 = 0x07;
export const SQ_A8 = 0x70;
export const SQ_B8 = 0x71;
export const SQ_C8 = 0x72;
export const SQ_D8 = 0x73;
export const SQ_E8 = 0x74;
export const SQ_F8 = 0x75;
export const SQ_G8 = 0x76;
export const SQ_H8 = 0x77;

export function makePiece(color, type) {
  return type | (color << 3);
}

export function pieceType(piece) {
  return piece & 7;
}

export function pieceColor(piece) {
  return piece >> 3;
}

export function makeSquare(file, rank) {
  return (rank << 4) | file;
}

export function fileOf(square) {
  return square & 7;
}

export function rankOf(square) {
  return square >> 4;
}

export function onBoard(square) {
  return (square & 0x88) === 0;
}

// Converts a 0x88 square to a 0..63 index (a1 = 0, h8 = 63).
export function to64(square) {
  return (square >> 4) * 8 + (square & 7);
}

export function from64(index) {
  return ((index >> 3) << 4) | (index & 7);
}

export function squareName(square) {
  return FILES[square & 7] + RANKS[square >> 4];
}

export function parseSquare(name) {
  if (typeof name !== 'string' || name.length !== 2) return -1;
  const file = FILES.indexOf(name[0]);
  const rank = RANKS.indexOf(name[1]);
  if (file < 0 || rank < 0) return -1;
  return makeSquare(file, rank);
}

export function isLightSquare(square) {
  return ((square >> 4) + (square & 7)) % 2 === 1;
}

// Moves are packed into a single integer so they can live in typed arrays:
//   bits 0-6   from square
//   bits 7-13  to square
//   bits 14-16 promotion piece type
//   bits 17-21 flags
export function encodeMove(from, to, promo, flags) {
  return from | (to << 7) | (promo << 14) | (flags << 17);
}

export function moveFrom(move) {
  return move & 127;
}

export function moveTo(move) {
  return (move >> 7) & 127;
}

export function movePromo(move) {
  return (move >> 14) & 7;
}

export function moveFlags(move) {
  return (move >> 17) & 31;
}

export const NO_MOVE = 0;

// Long algebraic ("UCI") notation, e.g. e2e4 or e7e8q.
export function moveToUci(move) {
  const promo = movePromo(move);
  return squareName(moveFrom(move)) + squareName(moveTo(move)) + (promo ? PIECE_LETTERS[promo] : '');
}

export function pieceToChar(piece) {
  if (!piece) return '.';
  const letter = PIECE_LETTERS[pieceType(piece)];
  return pieceColor(piece) === WHITE ? letter.toUpperCase() : letter;
}

export function charToPiece(ch) {
  const type = PIECE_LETTERS.indexOf(ch.toLowerCase());
  if (type <= 0) return EMPTY;
  return makePiece(ch === ch.toUpperCase() ? WHITE : BLACK, type);
}

export function colorName(color) {
  return color === WHITE ? 'White' : 'Black';
}
