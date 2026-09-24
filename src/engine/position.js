// Position: the board state plus everything needed to generate, make and
// unmake moves quickly. This class is shared by the rules layer (Game) and the
// search, so it favours speed: typed arrays, packed integer moves, and an
// undo stack instead of copying the board.

import {
  WHITE, BLACK, EMPTY, PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING,
  CASTLE_WK, CASTLE_WQ, CASTLE_BK, CASTLE_BQ,
  FLAG_CAPTURE, FLAG_EP, FLAG_CASTLE, FLAG_DOUBLE, FLAG_PROMO,
  KNIGHT_OFFSETS, BISHOP_OFFSETS, ROOK_OFFSETS, KING_OFFSETS,
  SQ_A1, SQ_C1, SQ_D1, SQ_E1, SQ_F1, SQ_G1, SQ_H1, SQ_A8, SQ_C8, SQ_D8, SQ_E8, SQ_F8, SQ_G8, SQ_H8,
  makePiece, pieceType, pieceColor, encodeMove, moveFrom, moveTo, movePromo, moveFlags,
  fileOf, rankOf, isLightSquare,
} from './constants.js';
import {
  ZOBRIST_PIECE_LO, ZOBRIST_PIECE_HI, ZOBRIST_CASTLE_LO, ZOBRIST_CASTLE_HI,
  ZOBRIST_EP_LO, ZOBRIST_EP_HI, ZOBRIST_SIDE_LO, ZOBRIST_SIDE_HI,
} from './zobrist.js';

// castling &= CASTLE_MASK[from] & CASTLE_MASK[to] keeps the rights current:
// moving a king or rook, or capturing a rook on its home square, clears them.
const CASTLE_MASK = new Uint8Array(128).fill(15);
CASTLE_MASK[SQ_A1] = 15 & ~CASTLE_WQ;
CASTLE_MASK[SQ_E1] = 15 & ~(CASTLE_WK | CASTLE_WQ);
CASTLE_MASK[SQ_H1] = 15 & ~CASTLE_WK;
CASTLE_MASK[SQ_A8] = 15 & ~CASTLE_BQ;
CASTLE_MASK[SQ_E8] = 15 & ~(CASTLE_BK | CASTLE_BQ);
CASTLE_MASK[SQ_H8] = 15 & ~CASTLE_BK;

const PROMO_TYPES = [QUEEN, ROOK, BISHOP, KNIGHT];

// Number of integers pushed per ply onto the undo stack.
const UNDO_SIZE = 7;

export class Position {
  constructor() {
    this.board = new Int8Array(128);
    this.turn = WHITE;
    this.castling = 0;
    this.ep = -1;
    this.halfmove = 0;
    this.fullmove = 1;
    this.kings = [-1, -1];
    this.hashLo = 0;
    this.hashHi = 0;
    // Flat undo stack: move, captured piece, castling, ep, halfmove, hashLo, hashHi.
    this.undoStack = [];
    // Hashes of every earlier position, for repetition detection.
    this.historyLo = [];
    this.historyHi = [];
  }

  clone() {
    const p = new Position();
    p.board.set(this.board);
    p.turn = this.turn;
    p.castling = this.castling;
    p.ep = this.ep;
    p.halfmove = this.halfmove;
    p.fullmove = this.fullmove;
    p.kings = this.kings.slice();
    p.hashLo = this.hashLo;
    p.hashHi = this.hashHi;
    p.undoStack = this.undoStack.slice();
    p.historyLo = this.historyLo.slice();
    p.historyHi = this.historyHi.slice();
    return p;
  }

  clear() {
    this.board.fill(EMPTY);
    this.turn = WHITE;
    this.castling = 0;
    this.ep = -1;
    this.halfmove = 0;
    this.fullmove = 1;
    this.kings = [-1, -1];
    this.undoStack.length = 0;
    this.historyLo.length = 0;
    this.historyHi.length = 0;
    this.hashLo = 0;
    this.hashHi = 0;
  }

  // Places a piece outside of normal move making (used by FEN parsing and editors).
  put(square, piece) {
    this.board[square] = piece;
    if (pieceType(piece) === KING) this.kings[pieceColor(piece)] = square;
  }

  get(square) {
    return this.board[square];
  }

  get ply() {
    return this.historyLo.length;
  }

  // Whether an en passant capture onto `ep` is at least pseudo-legal. The hash
  // only includes the ep file when this holds, so positions that differ only by
  // an unusable ep square count as repetitions (matching FIDE rules and Polyglot).
  epCapturable() {
    if (this.ep < 0) return false;
    const pawn = makePiece(this.turn, PAWN);
    if (this.turn === WHITE) {
      return this.board[this.ep - 15] === pawn && !((this.ep - 15) & 0x88) ||
             this.board[this.ep - 17] === pawn && !((this.ep - 17) & 0x88);
    }
    return this.board[this.ep + 15] === pawn && !((this.ep + 15) & 0x88) ||
           this.board[this.ep + 17] === pawn && !((this.ep + 17) & 0x88);
  }

  computeHash() {
    let lo = 0;
    let hi = 0;
    for (let sq = 0; sq < 128; sq++) {
      if (sq & 0x88) { sq += 7; continue; }
      const p = this.board[sq];
      if (p) {
        lo ^= ZOBRIST_PIECE_LO[p * 128 + sq];
        hi ^= ZOBRIST_PIECE_HI[p * 128 + sq];
      }
    }
    lo ^= ZOBRIST_CASTLE_LO[this.castling];
    hi ^= ZOBRIST_CASTLE_HI[this.castling];
    if (this.epCapturable()) {
      lo ^= ZOBRIST_EP_LO[fileOf(this.ep)];
      hi ^= ZOBRIST_EP_HI[fileOf(this.ep)];
    }
    if (this.turn === BLACK) {
      lo ^= ZOBRIST_SIDE_LO;
      hi ^= ZOBRIST_SIDE_HI;
    }
    return [lo | 0, hi | 0];
  }

  refreshHash() {
    const [lo, hi] = this.computeHash();
    this.hashLo = lo;
    this.hashHi = hi;
  }

  // ---------------------------------------------------------------------------
  // Attack detection
  // ---------------------------------------------------------------------------

  isAttacked(square, byColor) {
    const board = this.board;
    const colorBits = byColor << 3;

    // Pawns: a white pawn attacks up the board, so it would sit below the square.
    const pawn = PAWN | colorBits;
    if (byColor === WHITE) {
      let s = square - 15;
      if (!(s & 0x88) && board[s] === pawn) return true;
      s = square - 17;
      if (!(s & 0x88) && board[s] === pawn) return true;
    } else {
      let s = square + 15;
      if (!(s & 0x88) && board[s] === pawn) return true;
      s = square + 17;
      if (!(s & 0x88) && board[s] === pawn) return true;
    }

    const knight = KNIGHT | colorBits;
    for (let i = 0; i < 8; i++) {
      const s = square + KNIGHT_OFFSETS[i];
      if (!(s & 0x88) && board[s] === knight) return true;
    }

    const king = KING | colorBits;
    for (let i = 0; i < 8; i++) {
      const s = square + KING_OFFSETS[i];
      if (!(s & 0x88) && board[s] === king) return true;
    }

    const bishop = BISHOP | colorBits;
    const rook = ROOK | colorBits;
    const queen = QUEEN | colorBits;

    for (let i = 0; i < 4; i++) {
      const d = BISHOP_OFFSETS[i];
      let s = square + d;
      while (!(s & 0x88)) {
        const p = board[s];
        if (p) {
          if (p === bishop || p === queen) return true;
          break;
        }
        s += d;
      }
    }

    for (let i = 0; i < 4; i++) {
      const d = ROOK_OFFSETS[i];
      let s = square + d;
      while (!(s & 0x88)) {
        const p = board[s];
        if (p) {
          if (p === rook || p === queen) return true;
          break;
        }
        s += d;
      }
    }

    return false;
  }

  // Lists every square holding a piece of `byColor` that attacks `square`.
  attackersOf(square, byColor) {
    const result = [];
    const board = this.board;
    const colorBits = byColor << 3;
    const pawnSources = byColor === WHITE ? [square - 15, square - 17] : [square + 15, square + 17];
    for (const s of pawnSources) {
      if (!(s & 0x88) && board[s] === (PAWN | colorBits)) result.push(s);
    }
    for (const d of KNIGHT_OFFSETS) {
      const s = square + d;
      if (!(s & 0x88) && board[s] === (KNIGHT | colorBits)) result.push(s);
    }
    for (const d of KING_OFFSETS) {
      const s = square + d;
      if (!(s & 0x88) && board[s] === (KING | colorBits)) result.push(s);
    }
    const scan = (offsets, a, b) => {
      for (const d of offsets) {
        let s = square + d;
        while (!(s & 0x88)) {
          const p = board[s];
          if (p) {
            if (p === (a | colorBits) || p === (b | colorBits)) result.push(s);
            break;
          }
          s += d;
        }
      }
    };
    scan(BISHOP_OFFSETS, BISHOP, QUEEN);
    scan(ROOK_OFFSETS, ROOK, QUEEN);
    return result;
  }

  inCheck(color = this.turn) {
    return this.isAttacked(this.kings[color], color ^ 1);
  }

  // ---------------------------------------------------------------------------
  // Move generation
  // ---------------------------------------------------------------------------

  // Appends pseudo-legal moves (they may leave the king in check) to `moves`.
  // With `capturesOnly`, only captures and promotions are produced, which is
  // what quiescence search wants.
  generateMoves(moves = [], capturesOnly = false) {
    const board = this.board;
    const us = this.turn;
    const them = us ^ 1;
    const usBits = us << 3;

    for (let from = 0; from < 128; from++) {
      if (from & 0x88) { from += 7; continue; }
      const piece = board[from];
      if (!piece || (piece & 8) !== usBits) continue;
      const type = piece & 7;

      if (type === PAWN) {
        this.generatePawnMoves(from, moves, capturesOnly);
        continue;
      }

      if (type === KNIGHT || type === KING) {
        const offsets = type === KNIGHT ? KNIGHT_OFFSETS : KING_OFFSETS;
        for (let i = 0; i < 8; i++) {
          const to = from + offsets[i];
          if (to & 0x88) continue;
          const target = board[to];
          if (!target) {
            if (!capturesOnly) moves.push(encodeMove(from, to, 0, 0));
          } else if ((target >> 3) === them) {
            moves.push(encodeMove(from, to, 0, FLAG_CAPTURE));
          }
        }
        if (type === KING && !capturesOnly) this.generateCastling(from, moves);
        continue;
      }

      const diagonal = type === BISHOP || type === QUEEN;
      const straight = type === ROOK || type === QUEEN;
      if (diagonal) this.generateSlides(from, BISHOP_OFFSETS, moves, capturesOnly, them);
      if (straight) this.generateSlides(from, ROOK_OFFSETS, moves, capturesOnly, them);
    }
    return moves;
  }

  generateSlides(from, offsets, moves, capturesOnly, them) {
    const board = this.board;
    for (let i = 0; i < 4; i++) {
      const d = offsets[i];
      let to = from + d;
      while (!(to & 0x88)) {
        const target = board[to];
        if (!target) {
          if (!capturesOnly) moves.push(encodeMove(from, to, 0, 0));
        } else {
          if ((target >> 3) === them) moves.push(encodeMove(from, to, 0, FLAG_CAPTURE));
          break;
        }
        to += d;
      }
    }
  }

  generatePawnMoves(from, moves, capturesOnly) {
    const board = this.board;
    const us = this.turn;
    const them = us ^ 1;
    const forward = us === WHITE ? 16 : -16;
    const startRank = us === WHITE ? 1 : 6;
    const promoRank = us === WHITE ? 7 : 0;

    const one = from + forward;
    if (!(one & 0x88) && !board[one]) {
      if (rankOf(one) === promoRank) {
        for (const promo of PROMO_TYPES) moves.push(encodeMove(from, one, promo, FLAG_PROMO));
      } else if (!capturesOnly) {
        moves.push(encodeMove(from, one, 0, 0));
        const two = one + forward;
        if (rankOf(from) === startRank && !board[two]) {
          moves.push(encodeMove(from, two, 0, FLAG_DOUBLE));
        }
      }
    }

    for (const side of [forward - 1, forward + 1]) {
      const to = from + side;
      if (to & 0x88) continue;
      const target = board[to];
      if (target && (target >> 3) === them) {
        if (rankOf(to) === promoRank) {
          for (const promo of PROMO_TYPES) moves.push(encodeMove(from, to, promo, FLAG_CAPTURE | FLAG_PROMO));
        } else {
          moves.push(encodeMove(from, to, 0, FLAG_CAPTURE));
        }
      } else if (to === this.ep) {
        moves.push(encodeMove(from, to, 0, FLAG_CAPTURE | FLAG_EP));
      }
    }
  }

  generateCastling(from, moves) {
    const board = this.board;
    const us = this.turn;
    const them = us ^ 1;
    if (us === WHITE) {
      if (from !== SQ_E1) return;
      if ((this.castling & CASTLE_WK) && !board[SQ_F1] && !board[SQ_G1] &&
          board[SQ_H1] === makePiece(WHITE, ROOK) &&
          !this.isAttacked(SQ_E1, them) && !this.isAttacked(SQ_F1, them) && !this.isAttacked(SQ_G1, them)) {
        moves.push(encodeMove(SQ_E1, SQ_G1, 0, FLAG_CASTLE));
      }
      if ((this.castling & CASTLE_WQ) && !board[SQ_D1] && !board[SQ_C1] && !board[SQ_C1 - 1] &&
          board[SQ_A1] === makePiece(WHITE, ROOK) &&
          !this.isAttacked(SQ_E1, them) && !this.isAttacked(SQ_D1, them) && !this.isAttacked(SQ_C1, them)) {
        moves.push(encodeMove(SQ_E1, SQ_C1, 0, FLAG_CASTLE));
      }
    } else {
      if (from !== SQ_E8) return;
      if ((this.castling & CASTLE_BK) && !board[SQ_F8] && !board[SQ_G8] &&
          board[SQ_H8] === makePiece(BLACK, ROOK) &&
          !this.isAttacked(SQ_E8, them) && !this.isAttacked(SQ_F8, them) && !this.isAttacked(SQ_G8, them)) {
        moves.push(encodeMove(SQ_E8, SQ_G8, 0, FLAG_CASTLE));
      }
      if ((this.castling & CASTLE_BQ) && !board[SQ_D8] && !board[SQ_C8] && !board[SQ_C8 - 1] &&
          board[SQ_A8] === makePiece(BLACK, ROOK) &&
          !this.isAttacked(SQ_E8, them) && !this.isAttacked(SQ_D8, them) && !this.isAttacked(SQ_C8, them)) {
        moves.push(encodeMove(SQ_E8, SQ_C8, 0, FLAG_CASTLE));
      }
    }
  }

  // Fully legal moves. Slower than pseudo-legal generation, so the search uses
  // makeMove's return value instead; everything else uses this.
  legalMoves() {
    const pseudo = this.generateMoves([]);
    const legal = [];
    for (const move of pseudo) {
      if (this.makeMove(move)) {
        legal.push(move);
        this.unmakeMove();
      }
    }
    return legal;
  }

  hasLegalMove() {
    const pseudo = this.generateMoves([]);
    for (const move of pseudo) {
      if (this.makeMove(move)) {
        this.unmakeMove();
        return true;
      }
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // Make / unmake
  // ---------------------------------------------------------------------------

  // Plays a pseudo-legal move. Returns false (and leaves the position unchanged)
  // if the move would leave the mover's king in check.
  makeMove(move) {
    const board = this.board;
    const from = moveFrom(move);
    const to = moveTo(move);
    const flags = moveFlags(move);
    const promo = movePromo(move);
    const piece = board[from];
    const us = this.turn;
    const them = us ^ 1;

    let captured = board[to];
    let capSq = to;
    if (flags & FLAG_EP) {
      capSq = us === WHITE ? to - 16 : to + 16;
      captured = board[capSq];
    }

    // Must be decided before the board changes: the capturing pawn may be the one moving.
    const oldEpHashed = this.ep >= 0 && this.epCapturable();

    const undo = this.undoStack;
    undo.push(move, captured, this.castling, this.ep, this.halfmove, this.hashLo, this.hashHi);
    this.historyLo.push(this.hashLo);
    this.historyHi.push(this.hashHi);

    let lo = this.hashLo;
    let hi = this.hashHi;

    // Remove the moving piece from its origin.
    lo ^= ZOBRIST_PIECE_LO[piece * 128 + from];
    hi ^= ZOBRIST_PIECE_HI[piece * 128 + from];
    board[from] = EMPTY;

    // Remove any captured piece.
    if (captured) {
      lo ^= ZOBRIST_PIECE_LO[captured * 128 + capSq];
      hi ^= ZOBRIST_PIECE_HI[captured * 128 + capSq];
      board[capSq] = EMPTY;
    }

    // Place the piece (or its promotion) on the destination.
    const placed = promo ? makePiece(us, promo) : piece;
    board[to] = placed;
    lo ^= ZOBRIST_PIECE_LO[placed * 128 + to];
    hi ^= ZOBRIST_PIECE_HI[placed * 128 + to];

    if ((piece & 7) === KING) {
      this.kings[us] = to;
      if (flags & FLAG_CASTLE) {
        let rookFrom;
        let rookTo;
        if (to === SQ_G1) { rookFrom = SQ_H1; rookTo = SQ_F1; }
        else if (to === SQ_C1) { rookFrom = SQ_A1; rookTo = SQ_D1; }
        else if (to === SQ_G8) { rookFrom = SQ_H8; rookTo = SQ_F8; }
        else { rookFrom = SQ_A8; rookTo = SQ_D8; }
        const rook = board[rookFrom];
        board[rookFrom] = EMPTY;
        board[rookTo] = rook;
        lo ^= ZOBRIST_PIECE_LO[rook * 128 + rookFrom] ^ ZOBRIST_PIECE_LO[rook * 128 + rookTo];
        hi ^= ZOBRIST_PIECE_HI[rook * 128 + rookFrom] ^ ZOBRIST_PIECE_HI[rook * 128 + rookTo];
      }
    }

    // Castling rights.
    const newCastling = this.castling & CASTLE_MASK[from] & CASTLE_MASK[to];
    if (newCastling !== this.castling) {
      lo ^= ZOBRIST_CASTLE_LO[this.castling] ^ ZOBRIST_CASTLE_LO[newCastling];
      hi ^= ZOBRIST_CASTLE_HI[this.castling] ^ ZOBRIST_CASTLE_HI[newCastling];
      this.castling = newCastling;
    }

    // En passant: drop the old key (if it was hashed) and maybe add a new one.
    if (oldEpHashed) {
      lo ^= ZOBRIST_EP_LO[fileOf(this.ep)];
      hi ^= ZOBRIST_EP_HI[fileOf(this.ep)];
    }
    this.ep = (flags & FLAG_DOUBLE) ? (from + to) >> 1 : -1;

    this.halfmove = ((piece & 7) === PAWN || captured) ? 0 : this.halfmove + 1;
    if (us === BLACK) this.fullmove++;

    this.turn = them;
    lo ^= ZOBRIST_SIDE_LO;
    hi ^= ZOBRIST_SIDE_HI;

    if (this.ep >= 0 && this.epCapturable()) {
      lo ^= ZOBRIST_EP_LO[fileOf(this.ep)];
      hi ^= ZOBRIST_EP_HI[fileOf(this.ep)];
    }

    this.hashLo = lo;
    this.hashHi = hi;

    if (this.isAttacked(this.kings[us], them)) {
      this.unmakeMove();
      return false;
    }
    return true;
  }

  unmakeMove() {
    const undo = this.undoStack;
    const n = undo.length - UNDO_SIZE;
    const move = undo[n];
    const captured = undo[n + 1];
    this.castling = undo[n + 2];
    this.ep = undo[n + 3];
    this.halfmove = undo[n + 4];
    this.hashLo = undo[n + 5];
    this.hashHi = undo[n + 6];
    undo.length = n;
    this.historyLo.pop();
    this.historyHi.pop();

    const board = this.board;
    const them = this.turn;
    const us = them ^ 1;
    this.turn = us;
    if (us === BLACK) this.fullmove--;

    const from = moveFrom(move);
    const to = moveTo(move);
    const flags = moveFlags(move);
    const moved = board[to];
    board[from] = (flags & FLAG_PROMO) ? makePiece(us, PAWN) : moved;
    board[to] = EMPTY;

    if (flags & FLAG_EP) {
      board[us === WHITE ? to - 16 : to + 16] = captured;
    } else if (captured) {
      board[to] = captured;
    }

    if ((moved & 7) === KING) {
      this.kings[us] = from;
      if (flags & FLAG_CASTLE) {
        let rookFrom;
        let rookTo;
        if (to === SQ_G1) { rookFrom = SQ_H1; rookTo = SQ_F1; }
        else if (to === SQ_C1) { rookFrom = SQ_A1; rookTo = SQ_D1; }
        else if (to === SQ_G8) { rookFrom = SQ_H8; rookTo = SQ_F8; }
        else { rookFrom = SQ_A8; rookTo = SQ_D8; }
        board[rookFrom] = board[rookTo];
        board[rookTo] = EMPTY;
      }
    }
    return move;
  }

  // A "pass" used by null-move pruning. Resetting the halfmove clock stops the
  // repetition check from looking back across the null move.
  makeNullMove() {
    this.undoStack.push(0, 0, this.castling, this.ep, this.halfmove, this.hashLo, this.hashHi);
    this.historyLo.push(this.hashLo);
    this.historyHi.push(this.hashHi);
    let lo = this.hashLo;
    let hi = this.hashHi;
    if (this.ep >= 0 && this.epCapturable()) {
      lo ^= ZOBRIST_EP_LO[fileOf(this.ep)];
      hi ^= ZOBRIST_EP_HI[fileOf(this.ep)];
    }
    this.ep = -1;
    this.halfmove = 0;
    this.turn ^= 1;
    this.hashLo = lo ^ ZOBRIST_SIDE_LO;
    this.hashHi = hi ^ ZOBRIST_SIDE_HI;
  }

  unmakeNullMove() {
    const undo = this.undoStack;
    const n = undo.length - UNDO_SIZE;
    this.castling = undo[n + 2];
    this.ep = undo[n + 3];
    this.halfmove = undo[n + 4];
    this.hashLo = undo[n + 5];
    this.hashHi = undo[n + 6];
    undo.length = n;
    this.historyLo.pop();
    this.historyHi.pop();
    this.turn ^= 1;
  }

  lastMove() {
    const n = this.undoStack.length;
    return n ? this.undoStack[n - UNDO_SIZE] : 0;
  }

  // ---------------------------------------------------------------------------
  // Draw rules
  // ---------------------------------------------------------------------------

  // Counts how many earlier positions (within the reversible-move window) match
  // the current one.
  repetitionCount() {
    let count = 0;
    const len = this.historyLo.length;
    const limit = Math.max(0, len - this.halfmove);
    for (let i = len - 2; i >= limit; i -= 2) {
      if (this.historyLo[i] === this.hashLo && this.historyHi[i] === this.hashHi) count++;
    }
    return count;
  }

  isRepetition() {
    return this.repetitionCount() > 0;
  }

  // True when neither side can possibly deliver mate: K v K, K+minor v K, and
  // positions where all bishops stand on squares of one colour.
  isInsufficientMaterial() {
    let knights = 0;
    let bishops = 0;
    let lightBishops = 0;
    let darkBishops = 0;
    for (let sq = 0; sq < 128; sq++) {
      if (sq & 0x88) { sq += 7; continue; }
      const p = this.board[sq];
      if (!p) continue;
      const type = p & 7;
      if (type === PAWN || type === ROOK || type === QUEEN) return false;
      if (type === KNIGHT) knights++;
      if (type === BISHOP) {
        bishops++;
        if (isLightSquare(sq)) lightBishops++; else darkBishops++;
      }
    }
    if (knights + bishops <= 1) return true;
    if (knights === 0 && (lightBishops === 0 || darkBishops === 0)) return true;
    return false;
  }

  // Whether `color` has enough material to ever checkmate (used when the
  // opponent's flag falls: a lone king or king+minor can only draw).
  hasMatingMaterial(color) {
    let minors = 0;
    for (let sq = 0; sq < 128; sq++) {
      if (sq & 0x88) { sq += 7; continue; }
      const p = this.board[sq];
      if (!p || pieceColor(p) !== color) continue;
      const type = pieceType(p);
      if (type === PAWN || type === ROOK || type === QUEEN) return true;
      if (type === KNIGHT || type === BISHOP) minors++;
    }
    return minors >= 2;
  }

  hasNonPawnMaterial(color) {
    for (let sq = 0; sq < 128; sq++) {
      if (sq & 0x88) { sq += 7; continue; }
      const p = this.board[sq];
      if (p && (p >> 3) === color) {
        const type = p & 7;
        if (type !== PAWN && type !== KING) return true;
      }
    }
    return false;
  }

  // Material count per piece code, handy for the UI's captured-pieces display.
  pieceCounts() {
    const counts = new Array(16).fill(0);
    for (let sq = 0; sq < 128; sq++) {
      if (sq & 0x88) { sq += 7; continue; }
      const p = this.board[sq];
      if (p) counts[p]++;
    }
    return counts;
  }

  toString() {
    const rows = [];
    for (let rank = 7; rank >= 0; rank--) {
      let row = `${rank + 1} `;
      for (let file = 0; file < 8; file++) {
        const p = this.board[(rank << 4) | file];
        row += ' ' + (p ? ' PNBRQK'[p & 7][p & 8 ? 'toLowerCase' : 'toUpperCase']() : '.');
      }
      rows.push(row);
    }
    rows.push('   a b c d e f g h');
    return rows.join('\n');
  }
}
