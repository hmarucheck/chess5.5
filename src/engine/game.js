// Game: the rules-level view of a chess game. It wraps a Position, keeps a
// move history with SAN and FENs for every ply, decides results, and handles
// takebacks. The UI and the PGN layer talk to this class, never to Position.

import {
  WHITE, BLACK, PAWN, KING, START_FEN,
  FLAG_CAPTURE, FLAG_EP, FLAG_CASTLE, FLAG_PROMO, QUEEN,
  moveFrom, moveTo, movePromo, moveFlags, moveToUci, parseSquare, squareName,
  pieceType, pieceColor, colorName, PIECE_LETTERS,
} from './constants.js';
import { parseFen, toFen } from './fen.js';
import { moveToSan, sanToMove } from './san.js';

export const RESULT_WHITE = '1-0';
export const RESULT_BLACK = '0-1';
export const RESULT_DRAW = '1/2-1/2';
export const RESULT_NONE = '*';

export const REASONS = {
  checkmate: 'checkmate',
  stalemate: 'stalemate',
  insufficient: 'insufficient material',
  fiftyMove: 'fifty-move rule',
  threefold: 'threefold repetition',
  resignation: 'resignation',
  timeout: 'time forfeit',
  timeoutDraw: 'timeout vs insufficient material',
  agreement: 'agreement',
  abandoned: 'abandoned',
};

export class Game {
  constructor(fen = START_FEN) {
    this.load(fen);
  }

  load(fen = START_FEN) {
    this.position = parseFen(fen);
    this.startFen = toFen(this.position);
    this.history = [];
    this.result = RESULT_NONE;
    this.reason = null;
    this.headers = {};
    this.legalCache = null;
    this.refreshStatus();
  }

  get turn() {
    return this.position.turn;
  }

  get fen() {
    return toFen(this.position);
  }

  get ply() {
    return this.history.length;
  }

  get isOver() {
    return this.result !== RESULT_NONE;
  }

  get startsWithStandardPosition() {
    return this.startFen === START_FEN;
  }

  legalMoves() {
    if (!this.legalCache) this.legalCache = this.position.legalMoves();
    return this.legalCache;
  }

  // Legal moves as plain objects (for the UI), optionally from one square.
  moveObjects(fromSquare = null) {
    const from = typeof fromSquare === 'string' ? parseSquare(fromSquare) : fromSquare;
    return this.legalMoves()
      .filter((m) => from === null || moveFrom(m) === from)
      .map((m) => this.describe(m));
  }

  describe(move) {
    const flags = moveFlags(move);
    return {
      move,
      from: squareName(moveFrom(move)),
      to: squareName(moveTo(move)),
      promotion: movePromo(move) ? PIECE_LETTERS[movePromo(move)] : null,
      capture: !!(flags & FLAG_CAPTURE),
      enPassant: !!(flags & FLAG_EP),
      castle: !!(flags & FLAG_CASTLE),
      uci: moveToUci(move),
    };
  }

  inCheck() {
    return this.position.inCheck();
  }

  pieceAt(square) {
    const sq = typeof square === 'string' ? parseSquare(square) : square;
    const p = this.position.board[sq];
    if (!p) return null;
    return { type: PIECE_LETTERS[pieceType(p)], color: pieceColor(p) === WHITE ? 'w' : 'b', code: p };
  }

  // Finds the legal move matching the input, which may be an encoded move, a
  // SAN / UCI string, or an object {from, to, promotion}.
  findMove(input) {
    const legal = this.legalMoves();
    if (typeof input === 'number') return legal.includes(input) ? input : 0;
    if (typeof input === 'string') return sanToMove(this.position, input, legal);
    if (input && input.from && input.to) {
      const from = typeof input.from === 'string' ? parseSquare(input.from) : input.from;
      const to = typeof input.to === 'string' ? parseSquare(input.to) : input.to;
      const promo = input.promotion ? PIECE_LETTERS.indexOf(String(input.promotion).toLowerCase()) : 0;
      const candidates = legal.filter((m) => moveFrom(m) === from && moveTo(m) === to);
      if (!candidates.length) return 0;
      if (candidates.length === 1) return candidates[0];
      return candidates.find((m) => movePromo(m) === (promo || QUEEN)) || 0;
    }
    return 0;
  }

  // Whether moving from->to is a pawn promotion (so the UI should ask which piece).
  isPromotion(from, to) {
    const f = typeof from === 'string' ? parseSquare(from) : from;
    const t = typeof to === 'string' ? parseSquare(to) : to;
    return this.legalMoves().some((m) => moveFrom(m) === f && moveTo(m) === t && (moveFlags(m) & FLAG_PROMO));
  }

  // Plays a move. Returns the history record, or null if illegal / game over.
  move(input, { allowAfterEnd = false } = {}) {
    if (this.isOver && !allowAfterEnd) return null;
    const move = this.findMove(input);
    if (!move) return null;

    const pos = this.position;
    const fenBefore = toFen(pos);
    const san = moveToSan(pos, move, this.legalMoves());
    const piece = pos.board[moveFrom(move)];
    const flags = moveFlags(move);
    let captured = pos.board[moveTo(move)];
    if (flags & FLAG_EP) captured = pos.board[moveTo(move) + (pos.turn === WHITE ? -16 : 16)];

    pos.makeMove(move);
    this.legalCache = null;

    const record = {
      move,
      san,
      uci: moveToUci(move),
      from: squareName(moveFrom(move)),
      to: squareName(moveTo(move)),
      color: pieceColor(piece) === WHITE ? 'w' : 'b',
      piece: PIECE_LETTERS[pieceType(piece)],
      captured: captured ? PIECE_LETTERS[pieceType(captured)] : null,
      promotion: movePromo(move) ? PIECE_LETTERS[movePromo(move)] : null,
      flags,
      fenBefore,
      fenAfter: toFen(pos),
      check: pos.inCheck(),
      ply: this.history.length + 1,
      moveNumber: pos.turn === BLACK ? pos.fullmove : pos.fullmove - 1,
      comment: null,
      clock: null,
    };
    this.history.push(record);
    this.refreshStatus();
    record.mate = this.reason === REASONS.checkmate;
    return record;
  }

  // Takes back the last move. Clears any result that the move produced.
  undo() {
    if (!this.history.length) return null;
    const record = this.history.pop();
    this.position.unmakeMove();
    this.legalCache = null;
    this.result = RESULT_NONE;
    this.reason = null;
    this.refreshStatus();
    return record;
  }

  // Truncates the game back to `ply` half-moves (used when branching in analysis).
  truncate(ply) {
    while (this.history.length > ply) this.undo();
  }

  // Recomputes automatic results (mate, stalemate and the automatic draws).
  refreshStatus() {
    if (this.result !== RESULT_NONE && this.reason !== null &&
        ![REASONS.checkmate, REASONS.stalemate, REASONS.insufficient, REASONS.fiftyMove, REASONS.threefold]
          .includes(this.reason)) {
      return; // Keep manual results (resignation, timeout, agreement).
    }
    const status = this.detectStatus();
    if (status) {
      this.result = status.result;
      this.reason = status.reason;
    } else {
      this.result = RESULT_NONE;
      this.reason = null;
    }
  }

  detectStatus() {
    const pos = this.position;
    const hasMove = this.legalMoves().length > 0;
    if (!hasMove) {
      if (pos.inCheck()) {
        return { result: pos.turn === WHITE ? RESULT_BLACK : RESULT_WHITE, reason: REASONS.checkmate };
      }
      return { result: RESULT_DRAW, reason: REASONS.stalemate };
    }
    if (pos.isInsufficientMaterial()) return { result: RESULT_DRAW, reason: REASONS.insufficient };
    if (pos.halfmove >= 100) return { result: RESULT_DRAW, reason: REASONS.fiftyMove };
    if (pos.repetitionCount() >= 2) return { result: RESULT_DRAW, reason: REASONS.threefold };
    return null;
  }

  // Ends the game for a reason the board cannot see (resign, flag, agreement).
  setResult(result, reason) {
    this.result = result;
    this.reason = reason;
  }

  resign(color) {
    this.setResult(color === WHITE ? RESULT_BLACK : RESULT_WHITE, REASONS.resignation);
  }

  // A flag fall loses, unless the opponent could never mate (then it's a draw).
  timeout(color) {
    const opponent = color ^ 1;
    if (!this.position.hasMatingMaterial(opponent)) {
      this.setResult(RESULT_DRAW, REASONS.timeoutDraw);
    } else {
      this.setResult(opponent === WHITE ? RESULT_WHITE : RESULT_BLACK, REASONS.timeout);
    }
  }

  agreeDraw() {
    this.setResult(RESULT_DRAW, REASONS.agreement);
  }

  describeResult() {
    if (this.result === RESULT_NONE) return null;
    const winner = this.result === RESULT_WHITE ? 'White' : this.result === RESULT_BLACK ? 'Black' : null;
    switch (this.reason) {
      case REASONS.checkmate: return `Checkmate. ${winner} wins.`;
      case REASONS.resignation: return `${winner === 'White' ? 'Black' : 'White'} resigned. ${winner} wins.`;
      case REASONS.timeout: return `${winner === 'White' ? 'Black' : 'White'} ran out of time. ${winner} wins.`;
      case REASONS.timeoutDraw: return 'Time ran out, but the opponent cannot mate. Draw.';
      case REASONS.stalemate: return 'Stalemate. The game is drawn.';
      case REASONS.insufficient: return 'Neither side can mate. The game is drawn.';
      case REASONS.fiftyMove: return 'Fifty moves without a capture or pawn move. Draw.';
      case REASONS.threefold: return 'The same position appeared three times. Draw.';
      case REASONS.agreement: return 'Draw by agreement.';
      default: return winner ? `${winner} wins.` : 'Draw.';
    }
  }

  statusText() {
    if (this.isOver) return this.describeResult();
    const side = colorName(this.turn);
    return this.inCheck() ? `${side} to move, in check` : `${side} to move`;
  }

  // FEN of the position after `ply` half-moves (0 = start position).
  fenAt(ply) {
    if (ply <= 0) return this.startFen;
    return this.history[Math.min(ply, this.history.length) - 1].fenAfter;
  }

  sanList() {
    return this.history.map((h) => h.san);
  }

  uciList() {
    return this.history.map((h) => h.uci);
  }

  // Replays the game from its start position; used by PGN import and review.
  static fromMoves(moves, fen = START_FEN) {
    const game = new Game(fen);
    for (const m of moves) {
      if (!game.move(m)) throw new Error(`Illegal move "${m}" at ply ${game.ply + 1}.`);
    }
    return game;
  }

  // Material still on the board per side, and what each side has captured,
  // measured against the game's own starting position.
  materialSummary() {
    const start = parseFen(this.startFen).pieceCounts();
    const now = this.position.pieceCounts();
    const values = [0, 1, 3, 3, 5, 9, 0];
    const captured = { w: [], b: [] }; // pieces each colour has taken
    let whiteMaterial = 0;
    let blackMaterial = 0;
    for (let type = PAWN; type <= KING; type++) {
      const whiteCode = type;
      const blackCode = type | 8;
      whiteMaterial += now[whiteCode] * values[type];
      blackMaterial += now[blackCode] * values[type];
      // Promotions can make a count exceed the start count; clamp at zero.
      const whiteLost = Math.max(0, start[whiteCode] - now[whiteCode]);
      const blackLost = Math.max(0, start[blackCode] - now[blackCode]);
      for (let i = 0; i < blackLost; i++) captured.w.push(PIECE_LETTERS[type]);
      for (let i = 0; i < whiteLost; i++) captured.b.push(PIECE_LETTERS[type]);
    }
    return { captured, advantage: whiteMaterial - blackMaterial };
  }
}

