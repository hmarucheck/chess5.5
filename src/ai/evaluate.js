// Static evaluation.
//
// The backbone is a tapered PeSTO evaluation: separate middlegame and endgame
// piece-square tables blended by how much material is left. On top of that sit
// pawn structure, mobility, rook files, king shelter, the bishop pair, a
// "mop-up" term that teaches the engine to mate a bare king, and scaling for
// drawish endgames. Scores are in centipawns from the side to move's view.

import { WHITE, BLACK, PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING,
  KNIGHT_OFFSETS, BISHOP_OFFSETS, ROOK_OFFSETS } from '../engine/constants.js';

// Material values, middlegame and endgame, indexed by piece type.
export const MG_VALUE = [0, 82, 337, 365, 477, 1025, 0];
export const EG_VALUE = [0, 94, 281, 297, 512, 936, 0];

// Simple values used for move ordering, SEE and pruning margins.
export const SEE_VALUE = [0, 100, 320, 330, 500, 900, 20000];

const PHASE_INC = [0, 0, 1, 1, 2, 4, 0];
const MAX_PHASE = 24;

// PeSTO tables, written from White's point of view with a8 first.
const MG_PAWN = [
    0,   0,   0,   0,   0,   0,  0,   0,
   98, 134,  61,  95,  68, 126, 34, -11,
   -6,   7,  26,  31,  65,  56, 25, -20,
  -14,  13,   6,  21,  23,  12, 17, -23,
  -27,  -2,  -5,  12,  17,   6, 10, -25,
  -26,  -4,  -4, -10,   3,   3, 33, -12,
  -35,  -1, -20, -23, -15,  24, 38, -22,
    0,   0,   0,   0,   0,   0,  0,   0,
];
const EG_PAWN = [
    0,   0,   0,   0,   0,   0,   0,   0,
  178, 173, 158, 134, 147, 132, 165, 187,
   94, 100,  85,  67,  56,  53,  82,  84,
   32,  24,  13,   5,  -2,   4,  17,  17,
   13,   9,  -3,  -7,  -7,  -8,   3,  -1,
    4,   7,  -6,   1,   0,  -5,  -1,  -8,
   13,   8,   8,  10,  13,   0,   2,  -7,
    0,   0,   0,   0,   0,   0,   0,   0,
];
const MG_KNIGHT = [
  -167, -89, -34, -49,  61, -97, -15, -107,
   -73, -41,  72,  36,  23,  62,   7,  -17,
   -47,  60,  37,  65,  84, 129,  73,   44,
    -9,  17,  19,  53,  37,  69,  18,   22,
   -13,   4,  16,  13,  28,  19,  21,   -8,
   -23,  -9,  12,  10,  19,  17,  25,  -16,
   -29, -53, -12,  -3,  -1,  18, -14,  -19,
  -105, -21, -58, -33, -17, -28, -19,  -23,
];
const EG_KNIGHT = [
  -58, -38, -13, -28, -31, -27, -63, -99,
  -25,  -8, -25,  -2,  -9, -25, -24, -52,
  -24, -20,  10,   9,  -1,  -9, -19, -41,
  -17,   3,  22,  22,  22,  11,   8, -18,
  -18,  -6,  16,  25,  16,  17,   4, -18,
  -23,  -3,  -1,  15,  10,  -3, -20, -22,
  -42, -20, -10,  -5,  -2, -20, -23, -44,
  -29, -51, -23, -15, -22, -18, -50, -64,
];
const MG_BISHOP = [
  -29,   4, -82, -37, -25, -42,   7,  -8,
  -26,  16, -18, -13,  30,  59,  18, -47,
  -16,  37,  43,  40,  35,  50,  37,  -2,
   -4,   5,  19,  50,  37,  37,   7,  -2,
   -6,  13,  13,  26,  34,  12,  10,   4,
    0,  15,  15,  15,  14,  27,  18,  10,
    4,  15,  16,   0,   7,  21,  33,   1,
  -33,  -3, -14, -21, -13, -12, -39, -21,
];
const EG_BISHOP = [
  -14, -21, -11,  -8,  -7,  -9, -17, -24,
   -8,  -4,   7, -12,  -3, -13,  -4, -14,
    2,  -8,   0,  -1,  -2,   6,   0,   4,
   -3,   9,  12,   9,  14,  10,   3,   2,
   -6,   3,  13,  19,   7,  10,  -3,  -9,
  -12,  -3,   8,  10,  13,   3,  -7, -15,
  -14, -18,  -7,  -1,   4,  -9, -15, -27,
  -23,  -9, -23,  -5,  -9, -16,  -5, -17,
];
const MG_ROOK = [
   32,  42,  32,  51,  63,   9,  31,  43,
   27,  32,  58,  62,  80,  67,  26,  44,
   -5,  19,  26,  36,  17,  45,  61,  16,
  -24, -11,   7,  26,  24,  35,  -8, -20,
  -36, -26, -12,  -1,   9,  -7,   6, -23,
  -45, -25, -16, -17,   3,   0,  -5, -33,
  -44, -16, -20,  -9,  -1,  11,  -6, -71,
  -19, -13,   1,  17,  16,   7, -37, -26,
];
const EG_ROOK = [
   13,  10,  18,  15,  12,  12,   8,   5,
   11,  13,  13,  11,  -3,   3,   8,   3,
    7,   7,   7,   5,   4,  -3,  -5,  -3,
    4,   3,  13,   1,   2,   1,  -1,   2,
    3,   5,   8,   4,  -5,  -6,  -8, -11,
   -4,   0,  -5,  -1,  -7, -12,  -8, -16,
   -6,  -6,   0,   2,  -9,  -9, -11,  -3,
   -9,   2,   3,  -1,  -5, -13,   4, -20,
];
const MG_QUEEN = [
  -28,   0,  29,  12,  59,  44,  43,  45,
  -24, -39,  -5,   1, -16,  57,  28,  54,
  -13, -17,   7,   8,  29,  56,  47,  57,
  -27, -27, -16, -16,  -1,  17,  -2,   1,
   -9, -26,  -9, -10,  -2,  -4,   3,  -3,
  -14,   2, -11,  -2,  -5,   2,  14,   5,
  -35,  -8,  11,   2,   8,  15,  -3,   1,
   -1, -18,  -9,  10, -15, -25, -31, -50,
];
const EG_QUEEN = [
   -9,  22,  22,  27,  27,  19,  10,  20,
  -17,  20,  32,  41,  58,  25,  30,   0,
  -20,   6,   9,  49,  47,  35,  19,   9,
    3,  22,  24,  45,  57,  40,  57,  36,
  -18,  28,  19,  47,  31,  34,  39,  23,
  -16, -27,  15,   6,   9,  17,  10,   5,
  -22, -23, -30, -16, -16, -23, -36, -32,
  -33, -28, -22, -43,  -5, -32, -20, -41,
];
const MG_KING = [
  -65,  23,  16, -15, -56, -34,   2,  13,
   29,  -1, -20,  -7,  -8,  -4, -38, -29,
   -9,  24,   2, -16, -20,   6,  22, -22,
  -17, -20, -12, -27, -30, -25, -14, -36,
  -49,  -1, -27, -39, -46, -44, -33, -51,
  -14, -14, -22, -46, -44, -30, -15, -27,
    1,   7,  -8, -64, -43, -16,   9,   8,
  -15,  36,  12, -54,   8, -28,  24,  14,
];
const EG_KING = [
  -74, -35, -18, -18, -11,  15,   4, -17,
  -12,  17,  14,  17,  17,  38,  23,  11,
   10,  17,  23,  15,  20,  45,  44,  13,
   -8,  22,  24,  27,  26,  33,  26,   3,
  -18,  -4,  21,  24,  27,  23,   9, -11,
  -19,  -3,  11,  21,  23,  16,   7,  -9,
  -27, -11,   4,  13,  14,   4,  -5, -17,
  -53, -34, -21, -11, -28, -14, -24, -43,
];

const MG_TABLES = [null, MG_PAWN, MG_KNIGHT, MG_BISHOP, MG_ROOK, MG_QUEEN, MG_KING];
const EG_TABLES = [null, EG_PAWN, EG_KNIGHT, EG_BISHOP, EG_ROOK, EG_QUEEN, EG_KING];

// Combined material + PST lookups indexed by piece code * 128 + 0x88 square.
const MG_PST = new Int16Array(16 * 128);
const EG_PST = new Int16Array(16 * 128);

for (let type = PAWN; type <= KING; type++) {
  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) continue;
    const file = sq & 7;
    const rank = sq >> 4;
    const whiteIndex = (7 - rank) * 8 + file;
    const blackIndex = rank * 8 + file;
    MG_PST[type * 128 + sq] = MG_VALUE[type] + MG_TABLES[type][whiteIndex];
    EG_PST[type * 128 + sq] = EG_VALUE[type] + EG_TABLES[type][whiteIndex];
    MG_PST[(type | 8) * 128 + sq] = MG_VALUE[type] + MG_TABLES[type][blackIndex];
    EG_PST[(type | 8) * 128 + sq] = EG_VALUE[type] + EG_TABLES[type][blackIndex];
  }
}

// Positional term weights: [middlegame, endgame].
const BISHOP_PAIR = [30, 55];
const DOUBLED_PAWN = [-10, -22];
const ISOLATED_PAWN = [-12, -16];
const BACKWARD_PAWN = [-6, -8];
const CONNECTED_PAWN = [6, 9];
// Passed pawn bonus by relative rank (0 = own back rank).
const PASSED_MG = [0, 2, 5, 10, 22, 40, 65, 0];
const PASSED_EG = [0, 8, 14, 28, 50, 85, 130, 0];
const ROOK_OPEN_FILE = [28, 12];
const ROOK_SEMI_OPEN = [12, 8];
const ROOK_SEVENTH = [12, 26];
const KNIGHT_MOBILITY = [4, 4];
const BISHOP_MOBILITY = [5, 5];
const ROOK_MOBILITY = [2, 4];
const QUEEN_MOBILITY = [1, 2];
const KING_SHELTER = [12, 0];
const KING_OPEN_FILE = [-18, 0];
const TEMPO = 12;

// Distance of each square from the centre, for mop-up and king activity.
const CENTER_DISTANCE = new Int8Array(128);
for (let sq = 0; sq < 128; sq++) {
  if (sq & 0x88) continue;
  const f = sq & 7;
  const r = sq >> 4;
  CENTER_DISTANCE[sq] = Math.max(3 - Math.min(f, 7 - f), 3 - Math.min(r, 7 - r));
}

function squareDistance(a, b) {
  return Math.max(Math.abs((a & 7) - (b & 7)), Math.abs((a >> 4) - (b >> 4)));
}

// Scratch arrays reused across calls to avoid allocation in the hot path.
const pawnFileCount = [new Int8Array(8), new Int8Array(8)];
const pawnMinRank = [new Int8Array(8), new Int8Array(8)];
const pawnMaxRank = [new Int8Array(8), new Int8Array(8)];
const pawnSquares = [new Int16Array(8 * 8), new Int16Array(8 * 8)];
const pieceCount = new Int8Array(16);

function slideMobility(board, from, offsets, ownBits) {
  let count = 0;
  for (let i = 0; i < 4; i++) {
    const d = offsets[i];
    let s = from + d;
    while (!(s & 0x88)) {
      const p = board[s];
      if (p) {
        if ((p & 8) !== ownBits) count++;
        break;
      }
      count++;
      s += d;
    }
  }
  return count;
}

// Returns the evaluation from White's point of view, with a breakdown when
// `detail` is passed (used by the UI's "explain evaluation" panel).
export function evaluateWhite(pos, detail = null) {
  const board = pos.board;
  let mg = 0;
  let eg = 0;
  let phase = 0;

  pieceCount.fill(0);
  for (let c = 0; c < 2; c++) {
    pawnFileCount[c].fill(0);
    pawnMinRank[c].fill(8);
    pawnMaxRank[c].fill(-1);
  }
  const pawnTotals = [0, 0];

  // Pass 1: material, piece-square tables, pawn bookkeeping.
  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) { sq += 7; continue; }
    const p = board[sq];
    if (!p) continue;
    const type = p & 7;
    const color = p >> 3;
    pieceCount[p]++;
    phase += PHASE_INC[type];
    if (color === WHITE) {
      mg += MG_PST[p * 128 + sq];
      eg += EG_PST[p * 128 + sq];
    } else {
      mg -= MG_PST[p * 128 + sq];
      eg -= EG_PST[p * 128 + sq];
    }
    if (type === PAWN) {
      const f = sq & 7;
      const r = sq >> 4;
      pawnFileCount[color][f]++;
      if (r < pawnMinRank[color][f]) pawnMinRank[color][f] = r;
      if (r > pawnMaxRank[color][f]) pawnMaxRank[color][f] = r;
      pawnSquares[color][pawnTotals[color]++] = sq;
    }
  }
  if (detail) detail.material = { mg, eg };

  let structMg = 0;
  let structEg = 0;

  // Pawn structure.
  for (let color = 0; color < 2; color++) {
    const sign = color === WHITE ? 1 : -1;
    const them = color ^ 1;
    const files = pawnFileCount[color];
    for (let i = 0; i < pawnTotals[color]; i++) {
      const sq = pawnSquares[color][i];
      const f = sq & 7;
      const r = sq >> 4;
      const relRank = color === WHITE ? r : 7 - r;
      const hasLeft = f > 0 && files[f - 1] > 0;
      const hasRight = f < 7 && files[f + 1] > 0;

      if (!hasLeft && !hasRight) {
        structMg += sign * ISOLATED_PAWN[0];
        structEg += sign * ISOLATED_PAWN[1];
      } else {
        // Connected: a friendly pawn beside or diagonally behind.
        const back = color === WHITE ? -16 : 16;
        const own = PAWN | (color << 3);
        const connected =
          (f > 0 && (board[sq - 1] === own || board[sq + back - 1] === own)) ||
          (f < 7 && (board[sq + 1] === own || board[sq + back + 1] === own));
        if (connected) {
          structMg += sign * CONNECTED_PAWN[0] * (1 + (relRank >> 2));
          structEg += sign * CONNECTED_PAWN[1] * (1 + (relRank >> 2));
        } else {
          // Backward: no friendly pawn level with or behind it on adjacent files.
          let supported = false;
          for (const af of [f - 1, f + 1]) {
            if (af < 0 || af > 7 || !files[af]) continue;
            const rank = color === WHITE ? pawnMinRank[color][af] : pawnMaxRank[color][af];
            if (color === WHITE ? rank <= r : rank >= r) supported = true;
          }
          if (!supported) {
            structMg += sign * BACKWARD_PAWN[0];
            structEg += sign * BACKWARD_PAWN[1];
          }
        }
      }

      // Passed pawn: no enemy pawn ahead on this or adjacent files.
      let passed = true;
      for (let af = Math.max(0, f - 1); af <= Math.min(7, f + 1) && passed; af++) {
        if (!pawnFileCount[them][af]) continue;
        if (color === WHITE ? pawnMaxRank[them][af] > r : pawnMinRank[them][af] < r) passed = false;
      }
      if (passed) {
        let bonusMg = PASSED_MG[relRank];
        let bonusEg = PASSED_EG[relRank];
        // A blocked passer is worth much less.
        const ahead = sq + (color === WHITE ? 16 : -16);
        if (!(ahead & 0x88) && board[ahead]) {
          bonusMg >>= 1;
          bonusEg >>= 1;
        }
        // In the endgame, king proximity to the passer matters a lot.
        if (!(ahead & 0x88)) {
          const ownKing = squareDistance(pos.kings[color], ahead);
          const enemyKing = squareDistance(pos.kings[them], ahead);
          bonusEg += (enemyKing * 5 - ownKing * 2) * (relRank >= 3 ? relRank - 2 : 0);
        }
        structMg += sign * bonusMg;
        structEg += sign * bonusEg;
      }
    }
    for (let f = 0; f < 8; f++) {
      if (files[f] > 1) {
        structMg += sign * DOUBLED_PAWN[0] * (files[f] - 1);
        structEg += sign * DOUBLED_PAWN[1] * (files[f] - 1);
      }
    }
  }
  mg += structMg;
  eg += structEg;
  if (detail) detail.pawns = { mg: structMg, eg: structEg };

  // Pieces: mobility, rook files, seventh rank.
  let pieceMg = 0;
  let pieceEg = 0;
  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) { sq += 7; continue; }
    const p = board[sq];
    if (!p) continue;
    const type = p & 7;
    if (type === PAWN || type === KING) continue;
    const color = p >> 3;
    const sign = color === WHITE ? 1 : -1;
    const ownBits = color << 3;
    let mob = 0;
    if (type === KNIGHT) {
      for (let i = 0; i < 8; i++) {
        const s = sq + KNIGHT_OFFSETS[i];
        if (!(s & 0x88) && (!board[s] || (board[s] & 8) !== ownBits)) mob++;
      }
      pieceMg += sign * KNIGHT_MOBILITY[0] * (mob - 4);
      pieceEg += sign * KNIGHT_MOBILITY[1] * (mob - 4);
    } else if (type === BISHOP) {
      mob = slideMobility(board, sq, BISHOP_OFFSETS, ownBits);
      pieceMg += sign * BISHOP_MOBILITY[0] * (mob - 6);
      pieceEg += sign * BISHOP_MOBILITY[1] * (mob - 6);
    } else if (type === ROOK) {
      mob = slideMobility(board, sq, ROOK_OFFSETS, ownBits);
      pieceMg += sign * ROOK_MOBILITY[0] * (mob - 7);
      pieceEg += sign * ROOK_MOBILITY[1] * (mob - 7);
      const f = sq & 7;
      if (!pawnFileCount[color][f]) {
        if (!pawnFileCount[color ^ 1][f]) {
          pieceMg += sign * ROOK_OPEN_FILE[0];
          pieceEg += sign * ROOK_OPEN_FILE[1];
        } else {
          pieceMg += sign * ROOK_SEMI_OPEN[0];
          pieceEg += sign * ROOK_SEMI_OPEN[1];
        }
      }
      const relRank = color === WHITE ? sq >> 4 : 7 - (sq >> 4);
      if (relRank === 6) {
        pieceMg += sign * ROOK_SEVENTH[0];
        pieceEg += sign * ROOK_SEVENTH[1];
      }
    } else if (type === QUEEN) {
      mob = slideMobility(board, sq, BISHOP_OFFSETS, ownBits) + slideMobility(board, sq, ROOK_OFFSETS, ownBits);
      pieceMg += sign * QUEEN_MOBILITY[0] * (mob - 13);
      pieceEg += sign * QUEEN_MOBILITY[1] * (mob - 13);
    }
  }
  for (let color = 0; color < 2; color++) {
    if (pieceCount[BISHOP | (color << 3)] >= 2) {
      const sign = color === WHITE ? 1 : -1;
      pieceMg += sign * BISHOP_PAIR[0];
      pieceEg += sign * BISHOP_PAIR[1];
    }
  }
  mg += pieceMg;
  eg += pieceEg;
  if (detail) detail.pieces = { mg: pieceMg, eg: pieceEg };

  // King safety (middlegame only): pawn shield and open files near the king.
  let kingMg = 0;
  for (let color = 0; color < 2; color++) {
    const sign = color === WHITE ? 1 : -1;
    const ksq = pos.kings[color];
    const kf = ksq & 7;
    const forward = color === WHITE ? 16 : -16;
    const own = PAWN | (color << 3);
    let shield = 0;
    for (let df = -1; df <= 1; df++) {
      const f = kf + df;
      if (f < 0 || f > 7) continue;
      const one = ksq + forward + df;
      const two = one + forward;
      if (!(one & 0x88) && board[one] === own) shield += 2;
      else if (!(two & 0x88) && board[two] === own) shield += 1;
      if (!pawnFileCount[color][f]) kingMg += sign * KING_OPEN_FILE[0];
    }
    // Only reward a shield for a castled-looking king.
    const relRank = color === WHITE ? ksq >> 4 : 7 - (ksq >> 4);
    if (relRank <= 1 && (kf <= 2 || kf >= 5)) kingMg += sign * KING_SHELTER[0] * (shield >> 1);
  }
  mg += kingMg;
  if (detail) detail.king = { mg: kingMg, eg: 0 };

  // Blend middlegame and endgame by phase.
  const mgPhase = Math.min(phase, MAX_PHASE);
  // Truncation (not rounding or shifts) keeps the score exactly colour-symmetric.
  let score = Math.trunc((mg * mgPhase + eg * (MAX_PHASE - mgPhase)) / MAX_PHASE);

  // Mop-up: with a decisive material edge and no enemy pawns, drive the enemy
  // king to the edge and bring our own king closer, so the engine converts
  // KQ v K and KR v K instead of shuffling.
  const whiteMat = pieceCount[KNIGHT] * 3 + pieceCount[BISHOP] * 3 + pieceCount[ROOK] * 5 + pieceCount[QUEEN] * 9;
  const blackMat = pieceCount[KNIGHT | 8] * 3 + pieceCount[BISHOP | 8] * 3 + pieceCount[ROOK | 8] * 5 + pieceCount[QUEEN | 8] * 9;
  let mopUp = 0;
  if (whiteMat >= blackMat + 4 && !pieceCount[PAWN | 8] && mgPhase < 12) {
    mopUp = 10 * CENTER_DISTANCE[pos.kings[BLACK]] + 4 * (14 - manhattan(pos.kings[WHITE], pos.kings[BLACK]));
  } else if (blackMat >= whiteMat + 4 && !pieceCount[PAWN] && mgPhase < 12) {
    mopUp = -(10 * CENTER_DISTANCE[pos.kings[WHITE]] + 4 * (14 - manhattan(pos.kings[WHITE], pos.kings[BLACK])));
  }
  score += mopUp;
  if (detail) detail.mopUp = mopUp;

  // Drawish endgames: a side without pawns needs more than a minor piece extra.
  score = scaleDrawish(score, whiteMat, blackMat);

  if (detail) {
    detail.phase = mgPhase;
    detail.total = score;
  }
  return score;
}

function manhattan(a, b) {
  return Math.abs((a & 7) - (b & 7)) + Math.abs((a >> 4) - (b >> 4));
}

function scaleDrawish(score, whiteMat, blackMat) {
  const shrink = (value, by) => Math.trunc(value / by);
  if (score > 0 && !pieceCount[PAWN]) {
    // White has no pawns: KN v K, KB v K, KNN v K, K+minor v K+minor are drawn-ish.
    if (whiteMat < 4) return shrink(score, 16);
    if (whiteMat - blackMat < 4 && whiteMat <= 6) return shrink(score, 8);
    if (whiteMat === 6 && pieceCount[KNIGHT] === 2) return shrink(score, 16);
  }
  if (score < 0 && !pieceCount[PAWN | 8]) {
    if (blackMat < 4) return shrink(score, 16);
    if (blackMat - whiteMat < 4 && blackMat <= 6) return shrink(score, 8);
    if (blackMat === 6 && pieceCount[KNIGHT | 8] === 2) return shrink(score, 16);
  }
  return score;
}

export function evaluate(pos) {
  const score = evaluateWhite(pos) + (pos.turn === WHITE ? TEMPO : -TEMPO);
  return pos.turn === WHITE ? score : -score;
}

// Human-readable breakdown for the UI (White's perspective, centipawns).
export function explainEvaluation(pos) {
  const detail = {};
  evaluateWhite(pos, detail);
  const phase = detail.phase;
  const blend = (t) => Math.round((t.mg * phase + t.eg * (24 - phase)) / 24);
  return {
    total: detail.total,
    phase: Math.round((phase / 24) * 100),
    terms: [
      { name: 'Material and piece placement', value: blend(detail.material) },
      { name: 'Pawn structure', value: blend(detail.pawns) },
      { name: 'Piece activity', value: blend(detail.pieces) },
      { name: 'King safety', value: blend(detail.king) },
      { name: 'Endgame technique', value: Math.round(detail.mopUp) },
    ],
  };
}

