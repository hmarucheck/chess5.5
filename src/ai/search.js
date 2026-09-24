// The search: iterative deepening principal variation search (negamax
// alpha-beta) with a transposition table, aspiration windows, null-move
// pruning, late move reductions, reverse futility and futility pruning,
// check extensions, killer and history move ordering, static exchange
// evaluation, and a quiescence search to settle captures.

import {
  PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING, WHITE,
  FLAG_CAPTURE, FLAG_EP, FLAG_PROMO,
  KNIGHT_OFFSETS, KING_OFFSETS, BISHOP_OFFSETS, ROOK_OFFSETS,
  moveFrom, moveTo, moveFlags, movePromo, moveToUci,
} from '../engine/constants.js';
import { evaluate, SEE_VALUE } from './evaluate.js';
import { TranspositionTable, TT_EXACT, TT_LOWER, TT_UPPER } from './tt.js';

export const MATE = 30000;
export const MATE_BOUND = MATE - 1000;
export const INF = 32000;
export const MAX_PLY = 96;

const HISTORY_MAX = 16384;

// Late move reduction amounts, indexed [depth][moveNumber].
const LMR = [];
for (let d = 0; d < 64; d++) {
  LMR.push(new Int8Array(64));
  for (let m = 0; m < 64; m++) {
    LMR[d][m] = d && m ? Math.floor(0.75 + Math.log(d) * Math.log(m) / 2.25) : 0;
  }
}

const FUTILITY_MARGIN = [0, 120, 220, 330];

const now = typeof performance !== 'undefined' && performance.now
  ? () => performance.now()
  : () => Date.now();

// Scratch space for static exchange evaluation.
const seeGain = new Int32Array(40);
const seeRemovedSq = new Int16Array(40);
const seeRemovedPiece = new Int8Array(40);

// Finds the square of the least valuable piece of `color` attacking `target`,
// or -1. Pieces removed from the board by SEE naturally reveal x-rays.
function leastValuableAttacker(board, target, color) {
  const bits = color << 3;
  const pawn = PAWN | bits;
  if (color === WHITE) {
    if (!((target - 15) & 0x88) && board[target - 15] === pawn) return target - 15;
    if (!((target - 17) & 0x88) && board[target - 17] === pawn) return target - 17;
  } else {
    if (!((target + 15) & 0x88) && board[target + 15] === pawn) return target + 15;
    if (!((target + 17) & 0x88) && board[target + 17] === pawn) return target + 17;
  }
  const knight = KNIGHT | bits;
  for (let i = 0; i < 8; i++) {
    const s = target + KNIGHT_OFFSETS[i];
    if (!(s & 0x88) && board[s] === knight) return s;
  }
  let bishopSq = -1;
  let rookSq = -1;
  let queenSq = -1;
  for (let i = 0; i < 4; i++) {
    const d = BISHOP_OFFSETS[i];
    let s = target + d;
    while (!(s & 0x88)) {
      const p = board[s];
      if (p) {
        if (p === (BISHOP | bits) && bishopSq < 0) bishopSq = s;
        else if (p === (QUEEN | bits) && queenSq < 0) queenSq = s;
        break;
      }
      s += d;
    }
  }
  if (bishopSq >= 0) return bishopSq;
  for (let i = 0; i < 4; i++) {
    const d = ROOK_OFFSETS[i];
    let s = target + d;
    while (!(s & 0x88)) {
      const p = board[s];
      if (p) {
        if (p === (ROOK | bits) && rookSq < 0) rookSq = s;
        else if (p === (QUEEN | bits) && queenSq < 0) queenSq = s;
        break;
      }
      s += d;
    }
  }
  if (rookSq >= 0) return rookSq;
  if (queenSq >= 0) return queenSq;
  const king = KING | bits;
  for (let i = 0; i < 8; i++) {
    const s = target + KING_OFFSETS[i];
    if (!(s & 0x88) && board[s] === king) return s;
  }
  return -1;
}

// Static exchange evaluation: the material balance of the capture sequence on
// the destination square, assuming both sides always recapture with their
// cheapest piece and may stop whenever continuing would lose material.
export function see(pos, move) {
  const board = pos.board;
  const from = moveFrom(move);
  const to = moveTo(move);
  const flags = moveFlags(move);
  let removed = 0;

  let victimValue = flags & FLAG_EP ? SEE_VALUE[PAWN] : SEE_VALUE[board[to] & 7];
  let attackerValue = SEE_VALUE[board[from] & 7];
  if (flags & FLAG_PROMO) {
    victimValue += SEE_VALUE[movePromo(move)] - SEE_VALUE[PAWN];
    attackerValue = SEE_VALUE[movePromo(move)];
  }

  seeRemovedSq[removed] = from;
  seeRemovedPiece[removed++] = board[from];
  board[from] = 0;
  if (flags & FLAG_EP) {
    const capSq = pos.turn === WHITE ? to - 16 : to + 16;
    seeRemovedSq[removed] = capSq;
    seeRemovedPiece[removed++] = board[capSq];
    board[capSq] = 0;
  }

  let d = 0;
  seeGain[0] = victimValue;
  let side = pos.turn ^ 1;
  while (d < 38) {
    d++;
    seeGain[d] = attackerValue - seeGain[d - 1];
    if (Math.max(-seeGain[d - 1], seeGain[d]) < 0) break;
    const sq = leastValuableAttacker(board, to, side);
    if (sq < 0) break;
    attackerValue = SEE_VALUE[board[sq] & 7];
    seeRemovedSq[removed] = sq;
    seeRemovedPiece[removed++] = board[sq];
    board[sq] = 0;
    side ^= 1;
  }

  while (removed > 0) {
    removed--;
    board[seeRemovedSq[removed]] = seeRemovedPiece[removed];
  }
  while (--d > 0) seeGain[d - 1] = -Math.max(-seeGain[d - 1], seeGain[d]);
  return seeGain[0];
}

export function isMateScore(score) {
  return Math.abs(score) > MATE_BOUND;
}

// Converts an internal score to {cp} or {mate: n moves}, sign from the side
// to move's view.
export function scoreToObject(score) {
  if (score > MATE_BOUND) return { mate: Math.ceil((MATE - score) / 2) };
  if (score < -MATE_BOUND) return { mate: -Math.ceil((MATE + score) / 2) };
  return { cp: score };
}

export class Search {
  constructor({ hashMb = 16 } = {}) {
    this.tt = new TranspositionTable(hashMb);
    this.killers = new Int32Array(MAX_PLY * 2);
    this.history = new Int32Array(16 * 128);
    this.pvTable = new Int32Array(MAX_PLY * MAX_PLY);
    this.pvLength = new Int32Array(MAX_PLY + 1);
    this.moveStack = Array.from({ length: MAX_PLY + 1 }, () => []);
    this.scoreStack = Array.from({ length: MAX_PLY + 1 }, () => new Int32Array(256));
    this.staticEvals = new Int32Array(MAX_PLY + 1);
    this.pos = null;
    this.nodes = 0;
    this.seldepth = 0;
    this.stopped = false;
    this.deadline = Infinity;
    this.nodeLimit = Infinity;
    this.startTime = 0;
    this.stopCheck = null;
    this.iterBestMove = 0;
    this.iterBestScore = 0;
  }

  reset() {
    this.tt.clear();
    this.history.fill(0);
    this.killers.fill(0);
  }

  checkLimits() {
    if (this.nodes >= this.nodeLimit || now() >= this.deadline || (this.stopCheck && this.stopCheck())) {
      this.stopped = true;
    }
  }

  // ---------------------------------------------------------------------------
  // Move ordering
  // ---------------------------------------------------------------------------

  scoreMoves(moves, scores, ttMove, ply) {
    const board = this.pos.board;
    const killer1 = this.killers[ply * 2];
    const killer2 = this.killers[ply * 2 + 1];
    for (let i = 0; i < moves.length; i++) {
      const m = moves[i];
      if (m === ttMove) {
        scores[i] = 2000000;
        continue;
      }
      const flags = moveFlags(m);
      const from = moveFrom(m);
      const to = moveTo(m);
      if (flags & FLAG_CAPTURE) {
        const victim = flags & FLAG_EP ? PAWN : board[to] & 7;
        const attacker = board[from] & 7;
        const mvvLva = victim * 100 - attacker;
        // Winning or equal captures first; losing captures go to the back.
        if (victim >= attacker || see(this.pos, m) >= 0) scores[i] = 1000000 + mvvLva;
        else scores[i] = -30000 + mvvLva;
        if (flags & FLAG_PROMO) scores[i] += movePromo(m) === QUEEN ? 5000 : -2000;
      } else if (flags & FLAG_PROMO) {
        scores[i] = movePromo(m) === QUEEN ? 950000 : -40000;
      } else if (m === killer1) {
        scores[i] = 900000;
      } else if (m === killer2) {
        scores[i] = 800000;
      } else {
        scores[i] = this.history[board[from] * 128 + to];
      }
    }
  }

  scoreCaptures(moves, scores) {
    const board = this.pos.board;
    for (let i = 0; i < moves.length; i++) {
      const m = moves[i];
      const flags = moveFlags(m);
      const victim = flags & FLAG_EP ? PAWN : board[moveTo(m)] & 7;
      scores[i] = victim * 100 - (board[moveFrom(m)] & 7) + (flags & FLAG_PROMO ? movePromo(m) * 1000 : 0);
    }
  }

  // Moves the best-scored remaining move into slot `start` and returns it.
  pickMove(moves, scores, start) {
    let best = start;
    for (let i = start + 1; i < moves.length; i++) {
      if (scores[i] > scores[best]) best = i;
    }
    if (best !== start) {
      const m = moves[best];
      moves[best] = moves[start];
      moves[start] = m;
      const s = scores[best];
      scores[best] = scores[start];
      scores[start] = s;
    }
    return moves[start];
  }

  updateHistory(move, depth, good) {
    const index = this.pos.board[moveFrom(move)] * 128 + moveTo(move);
    const bonus = Math.min(depth * depth, 400) * (good ? 1 : -1);
    const h = this.history[index];
    this.history[index] = h + bonus - Math.trunc(h * Math.abs(bonus) / HISTORY_MAX);
  }

  // ---------------------------------------------------------------------------
  // Quiescence search
  // ---------------------------------------------------------------------------

  quiesce(alpha, beta, ply) {
    this.nodes++;
    if ((this.nodes & 2047) === 0) this.checkLimits();
    if (this.stopped) return 0;
    if (ply > this.seldepth) this.seldepth = ply;

    const pos = this.pos;
    if (ply >= MAX_PLY - 1) return evaluate(pos);

    const inCheck = pos.inCheck();
    let best;
    let standPat = 0;
    const moves = this.moveStack[ply];
    const scores = this.scoreStack[ply];
    moves.length = 0;

    if (inCheck) {
      best = -MATE + ply;
      pos.generateMoves(moves, false);
      this.scoreMoves(moves, scores, 0, ply);
    } else {
      standPat = evaluate(pos);
      if (standPat >= beta) return standPat;
      if (standPat > alpha) alpha = standPat;
      best = standPat;
      pos.generateMoves(moves, true);
      this.scoreCaptures(moves, scores);
    }

    let legal = 0;
    for (let i = 0; i < moves.length; i++) {
      const move = this.pickMove(moves, scores, i);
      if (!inCheck) {
        const flags = moveFlags(move);
        if (!(flags & FLAG_PROMO)) {
          const victim = flags & FLAG_EP ? PAWN : pos.board[moveTo(move)] & 7;
          // Delta pruning: even winning this piece cannot lift us to alpha.
          if (standPat + SEE_VALUE[victim] + 200 < alpha) continue;
        }
        if (see(pos, move) < 0) continue;
      }
      if (!pos.makeMove(move)) continue;
      legal++;
      const score = -this.quiesce(-beta, -alpha, ply + 1);
      pos.unmakeMove();
      if (this.stopped) return 0;
      if (score > best) {
        best = score;
        if (score > alpha) {
          alpha = score;
          if (score >= beta) break;
        }
      }
    }
    if (inCheck && legal === 0) return -MATE + ply;
    return best;
  }

  // ---------------------------------------------------------------------------
  // Main search
  // ---------------------------------------------------------------------------

  alphaBeta(depth, alpha, beta, ply, allowNull) {
    const pos = this.pos;
    this.pvLength[ply] = ply;
    const isPv = beta - alpha > 1;
    const rootNode = ply === 0;

    if (!rootNode) {
      if ((this.nodes & 2047) === 0) this.checkLimits();
      if (this.stopped) return 0;
      if (pos.halfmove >= 100 || pos.isRepetition()) return 0;
      // Mate distance pruning.
      const mateAlpha = Math.max(alpha, -MATE + ply);
      const mateBeta = Math.min(beta, MATE - ply - 1);
      if (mateAlpha >= mateBeta) return mateAlpha;
    }

    const inCheck = pos.inCheck();
    if (inCheck) depth++;
    if (depth <= 0) return this.quiesce(alpha, beta, ply);
    if (ply >= MAX_PLY - 1) return evaluate(pos);

    this.nodes++;

    // Transposition table probe.
    let ttMove = 0;
    const slot = this.tt.probe(pos.hashLo, pos.hashHi);
    if (slot >= 0) {
      ttMove = this.tt.moves[slot];
      if (!rootNode && this.tt.depths[slot] >= depth && !isPv) {
        let ttScore = this.tt.scores[slot];
        if (ttScore > MATE_BOUND) ttScore -= ply;
        else if (ttScore < -MATE_BOUND) ttScore += ply;
        const flag = this.tt.flags[slot];
        if (flag === TT_EXACT ||
            (flag === TT_LOWER && ttScore >= beta) ||
            (flag === TT_UPPER && ttScore <= alpha)) {
          return ttScore;
        }
      }
    }

    const staticEval = inCheck ? -INF : evaluate(pos);
    this.staticEvals[ply] = staticEval;
    const improving = !inCheck && ply >= 2 && staticEval > this.staticEvals[ply - 2];

    if (!isPv && !inCheck) {
      // Reverse futility pruning: far above beta at shallow depth.
      if (depth <= 6 && Math.abs(beta) < MATE_BOUND &&
          staticEval - (improving ? 70 : 90) * depth >= beta) {
        return staticEval;
      }

      // Null move pruning: if passing still beats beta, the position is good enough.
      if (allowNull && depth >= 3 && staticEval >= beta && pos.hasNonPawnMaterial(pos.turn)) {
        const R = 3 + Math.floor(depth / 6) + Math.min(3, Math.floor((staticEval - beta) / 200));
        pos.makeNullMove();
        const score = -this.alphaBeta(depth - 1 - R, -beta, -beta + 1, ply + 1, false);
        pos.unmakeNullMove();
        if (this.stopped) return 0;
        if (score >= beta) return score > MATE_BOUND ? beta : score;
      }
    }

    // Internal iterative reduction: without a hash move, this node is likely
    // less important, so search it a bit shallower.
    if (!ttMove && depth >= 4 && !rootNode) depth--;

    const moves = this.moveStack[ply];
    const scores = this.scoreStack[ply];
    moves.length = 0;
    pos.generateMoves(moves, false);
    this.scoreMoves(moves, scores, ttMove, ply);

    const origAlpha = alpha;
    let bestScore = -INF;
    let bestMove = 0;
    let legal = 0;
    const quietsTried = [];

    for (let i = 0; i < moves.length; i++) {
      const move = this.pickMove(moves, scores, i);
      const flags = moveFlags(move);
      const isQuiet = !(flags & (FLAG_CAPTURE | FLAG_PROMO));

      // Futility pruning: quiet moves that cannot raise alpha at low depth.
      if (!rootNode && !isPv && !inCheck && isQuiet && legal > 0 && depth <= 3 &&
          Math.abs(alpha) < MATE_BOUND && staticEval + FUTILITY_MARGIN[depth] <= alpha) {
        // Still must verify it isn't a checking move; checks are worth searching.
        if (!pos.makeMove(move)) continue;
        const givesCheck = pos.inCheck();
        pos.unmakeMove();
        if (!givesCheck) continue;
      }

      // Late move pruning: at very low depth, skip late quiet moves outright.
      if (!rootNode && !isPv && !inCheck && isQuiet && depth <= 3 && legal >= 4 + depth * depth * (improving ? 2 : 1) &&
          Math.abs(alpha) < MATE_BOUND) {
        continue;
      }

      if (!pos.makeMove(move)) continue;
      legal++;
      const givesCheck = pos.inCheck();

      let score;
      if (legal === 1) {
        score = -this.alphaBeta(depth - 1, -beta, -alpha, ply + 1, true);
      } else {
        let reduction = 0;
        if (depth >= 3 && legal > 3 && isQuiet && !inCheck && !givesCheck) {
          reduction = LMR[Math.min(depth, 63)][Math.min(legal, 63)];
          if (!isPv) reduction++;
          if (improving) reduction--;
          if (move === this.killers[ply * 2] || move === this.killers[ply * 2 + 1]) reduction--;
          reduction = Math.max(0, Math.min(reduction, depth - 2));
        }
        score = -this.alphaBeta(depth - 1 - reduction, -alpha - 1, -alpha, ply + 1, true);
        if (score > alpha && reduction > 0) {
          score = -this.alphaBeta(depth - 1, -alpha - 1, -alpha, ply + 1, true);
        }
        if (score > alpha && score < beta) {
          score = -this.alphaBeta(depth - 1, -beta, -alpha, ply + 1, true);
        }
      }
      pos.unmakeMove();
      if (this.stopped) return 0;

      if (score > bestScore) {
        bestScore = score;
        bestMove = move;
        if (score > alpha) {
          alpha = score;
          if (rootNode) {
            this.iterBestMove = move;
            this.iterBestScore = score;
          }
          // Update the principal variation.
          const row = ply * MAX_PLY;
          const next = (ply + 1) * MAX_PLY;
          this.pvTable[row + ply] = move;
          for (let j = ply + 1; j < this.pvLength[ply + 1]; j++) this.pvTable[row + j] = this.pvTable[next + j];
          this.pvLength[ply] = Math.max(ply + 1, this.pvLength[ply + 1]);

          if (score >= beta) {
            if (isQuiet) {
              if (this.killers[ply * 2] !== move) {
                this.killers[ply * 2 + 1] = this.killers[ply * 2];
                this.killers[ply * 2] = move;
              }
              this.updateHistory(move, depth, true);
              for (const q of quietsTried) this.updateHistory(q, depth, false);
            }
            break;
          }
        }
      }
      if (isQuiet) quietsTried.push(move);
    }

    if (legal === 0) {
      return inCheck ? -MATE + ply : 0;
    }

    let flag = TT_EXACT;
    if (bestScore >= beta) flag = TT_LOWER;
    else if (bestScore <= origAlpha) flag = TT_UPPER;
    let stored = bestScore;
    if (stored > MATE_BOUND) stored += ply;
    else if (stored < -MATE_BOUND) stored -= ply;
    this.tt.store(pos.hashLo, pos.hashHi, depth, flag, stored, flag === TT_UPPER ? 0 : bestMove);

    return bestScore;
  }

  // Reads the principal variation, extending it from the hash table if the
  // search's own PV was cut short by a transposition.
  collectPv(maxLength = 24) {
    const pv = [];
    for (let i = 0; i < this.pvLength[0]; i++) pv.push(this.pvTable[i]);
    const pos = this.pos;
    let made = 0;
    for (const move of pv) {
      if (!pos.makeMove(move)) break;
      made++;
    }
    while (pv.length < maxLength) {
      const slot = this.tt.probe(pos.hashLo, pos.hashHi);
      if (slot < 0) break;
      const move = this.tt.moves[slot];
      if (!move || !pos.legalMoves().includes(move)) break;
      if (pos.isRepetition()) break;
      pos.makeMove(move);
      made++;
      pv.push(move);
    }
    while (made-- > 0) pos.unmakeMove();
    return pv;
  }

  // Runs an iterative deepening search and returns the best move found.
  // Options: depth, timeMs, nodes, onInfo(info), stopCheck() -> boolean.
  search(pos, options = {}) {
    const maxDepth = Math.min(options.depth || 64, MAX_PLY - 10);
    this.pos = pos;
    this.nodes = 0;
    this.seldepth = 0;
    this.stopped = false;
    this.startTime = now();
    this.nodeLimit = options.nodes || Infinity;
    const timeMs = options.timeMs || Infinity;
    this.deadline = this.startTime + timeMs;
    // Don't start an iteration we probably can't finish.
    const softLimit = this.startTime + timeMs * 0.55;
    this.stopCheck = options.stopCheck || null;
    this.killers.fill(0);
    for (let i = 0; i < this.history.length; i++) this.history[i] >>= 2;
    this.tt.newSearch();

    const legal = pos.legalMoves();
    if (!legal.length) {
      return { bestMove: 0, score: pos.inCheck() ? -MATE : 0, depth: 0, pv: [], nodes: 0 };
    }

    let bestMove = legal[0];
    let bestScore = 0;
    let completedDepth = 0;
    let pv = [bestMove];
    let prevScore = 0;

    for (let depth = 1; depth <= maxDepth; depth++) {
      let score;
      this.iterBestMove = 0;
      if (depth >= 4) {
        let delta = 35;
        let alpha = Math.max(prevScore - delta, -INF);
        let beta = Math.min(prevScore + delta, INF);
        for (;;) {
          score = this.alphaBeta(depth, alpha, beta, 0, false);
          if (this.stopped) break;
          if (score <= alpha) {
            beta = Math.floor((alpha + beta) / 2);
            alpha = Math.max(score - delta, -INF);
          } else if (score >= beta) {
            beta = Math.min(score + delta, INF);
          } else {
            break;
          }
          delta += delta;
          if (delta > 1000) { alpha = -INF; beta = INF; }
        }
      } else {
        score = this.alphaBeta(depth, -INF, INF, 0, false);
      }

      // A partially searched iteration still helps: the previous best move is
      // searched first, so any root move that raised alpha before the stop is
      // at least as good. Otherwise keep the last complete result.
      if (this.stopped) {
        if (this.iterBestMove && completedDepth > 0) {
          if (this.iterBestMove !== bestMove) pv = [this.iterBestMove];
          bestMove = this.iterBestMove;
          bestScore = this.iterBestScore;
        }
        break;
      }

      if (this.pvLength[0] > 0 && this.pvTable[0]) bestMove = this.pvTable[0];
      bestScore = score;
      prevScore = score;
      completedDepth = depth;
      pv = this.collectPv();
      if (!pv.length || pv[0] !== bestMove) pv = [bestMove];

      const elapsed = now() - this.startTime;
      if (options.onInfo) {
        options.onInfo({
          depth,
          seldepth: this.seldepth,
          score: scoreToObject(score),
          rawScore: score,
          nodes: this.nodes,
          nps: Math.round(this.nodes / Math.max(elapsed, 1) * 1000),
          timeMs: Math.round(elapsed),
          hashfull: this.tt.hashfull(),
          pv: pv.map(moveToUci),
        });
      }

      // Found a forced mate we can't improve on, or out of time: stop.
      if (isMateScore(score) && depth >= (MATE - Math.abs(score)) + 2) break;
      if (legal.length === 1 && depth >= 4 && timeMs !== Infinity) break;
      if (now() >= softLimit) break;
    }

    return {
      bestMove,
      score: bestScore,
      depth: completedDepth,
      seldepth: this.seldepth,
      pv,
      nodes: this.nodes,
      timeMs: Math.round(now() - this.startTime),
    };
  }

  // Scores every root move with a full-window search at `depth`. Used by the
  // weaker playing levels, which then pick among good-but-imperfect moves.
  scoreRootMoves(pos, depth, options = {}) {
    this.pos = pos;
    this.nodes = 0;
    this.stopped = false;
    this.startTime = now();
    this.deadline = this.startTime + (options.timeMs || 5000);
    this.nodeLimit = Infinity;
    this.stopCheck = null;
    this.killers.fill(0);
    this.tt.newSearch();
    const results = [];
    for (const move of pos.legalMoves()) {
      pos.makeMove(move);
      const score = depth <= 1
        ? -this.quiesce(-INF, INF, 1)
        : -this.alphaBeta(depth - 1, -INF, INF, 1, true);
      pos.unmakeMove();
      if (this.stopped) break;
      results.push({ move, score });
    }
    results.sort((a, b) => b.score - a.score);
    return results;
  }
}
