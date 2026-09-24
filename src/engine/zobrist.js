// Zobrist hashing keys.
//
// JavaScript has no fast native 64-bit integer, so every key is split into two
// 32-bit halves. The low half indexes the transposition table and the high half
// verifies entries; together they give 64 bits of collision resistance.
//
// Keys come from a seeded generator so hashes are identical across runs, which
// keeps the opening book and the tests deterministic.

function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
}

const rand = mulberry32(0x5eed1e55);

function fill(length) {
  const arr = new Int32Array(length);
  for (let i = 0; i < length; i++) arr[i] = rand() | 0;
  return arr;
}

// Indexed by piece code * 128 + 0x88 square.
export const ZOBRIST_PIECE_LO = fill(16 * 128);
export const ZOBRIST_PIECE_HI = fill(16 * 128);

// Indexed by the 4-bit castling rights mask.
export const ZOBRIST_CASTLE_LO = fill(16);
export const ZOBRIST_CASTLE_HI = fill(16);

// Indexed by the file of the en passant target square.
export const ZOBRIST_EP_LO = fill(8);
export const ZOBRIST_EP_HI = fill(8);

export const ZOBRIST_SIDE_LO = rand() | 0;
export const ZOBRIST_SIDE_HI = rand() | 0;
