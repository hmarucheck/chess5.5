// Standard Algebraic Notation: generating it for moves and parsing it back.

import {
  PAWN, QUEEN,
  FLAG_CAPTURE, FLAG_CASTLE, FLAG_PROMO,
  moveFrom, moveTo, movePromo, moveFlags, pieceType, fileOf, rankOf,
  squareName, parseSquare, FILES, RANKS, PIECE_LETTERS, moveToUci,
} from './constants.js';

export const SAN_LETTERS = ['', '', 'N', 'B', 'R', 'Q', 'K'];
export const FIGURINES = ['', '', '♘', '♗', '♖', '♕', '♔'];

// Produces SAN for `move` in `pos`. `legal` may be supplied to avoid
// regenerating the legal move list when converting many moves.
export function moveToSan(pos, move, legal = null) {
  let san = sanBody(pos, move, legal || pos.legalMoves());
  // Check / mate suffix.
  if (pos.makeMove(move)) {
    if (pos.inCheck()) san += pos.hasLegalMove() ? '+' : '#';
    pos.unmakeMove();
  }
  return san;
}

// Replaces piece letters with Unicode chess figurines, e.g. "Nf3" -> "♘f3".
export function sanToFigurine(san) {
  return san.replace(/^[NBRQK]/, (ch) => FIGURINES[SAN_LETTERS.indexOf(ch)])
            .replace(/=([NBRQ])/, (_, ch) => '=' + FIGURINES[SAN_LETTERS.indexOf(ch)]);
}

// Strips decorations so different spellings of a move compare equal.
function normalize(text) {
  return text
    .trim()
    .replace(/[+#]+$/, '')
    .replace(/[!?]+$/, '')
    .replace(/[+#]+$/, '')
    .replace(/0-0-0|o-o-o/g, 'O-O-O')
    .replace(/0-0|o-o/g, 'O-O')
    .replace(/e\.p\.$/, '')
    .trim();
}

// Parses SAN (or long algebraic like "e2e4"/"e7e8q") into a legal move, or
// returns 0 when no legal move matches. Accepts common sloppy spellings: a
// missing "=" in promotions, lowercase promotion letters, over-disambiguation
// and an "x" left out of captures.
export function sanToMove(pos, text, legal = null) {
  if (typeof text !== 'string' || !text.trim()) return 0;
  const moves = legal || pos.legalMoves();
  const wanted = normalize(text);

  // Exact SAN match.
  for (const move of moves) {
    if (normalize(sanBody(pos, move, moves)) === wanted) return move;
  }

  // Long algebraic, optionally with a piece letter: "e2e4", "Ng1-f3", "e7xd8q".
  const uci = wanted.replace(/^[NBRQK](?=[a-h][1-8])/, '').toLowerCase().replace(/[-x=]/g, '');
  if (/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) {
    for (const move of moves) {
      if (moveToUci(move) === uci) return move;
      // Accept e7e8 as e7e8q.
      if (uci.length === 4 && moveToUci(move) === uci + 'q') return move;
    }
  }

  return sloppyMatch(pos, wanted, moves);
}

function sloppyMatch(pos, wanted, moves) {
  const m = /^([NBRQK])?([a-h])?([1-8])?x?([a-h][1-8])=?([NBRQnbrq])?$/.exec(wanted);
  if (!m) return 0;
  const [, pieceLetter, fromFile, fromRank, toName, promoLetter] = m;
  const type = pieceLetter ? SAN_LETTERS.indexOf(pieceLetter) : PAWN;
  const to = parseSquare(toName);
  const promo = promoLetter ? PIECE_LETTERS.indexOf(promoLetter.toLowerCase()) : 0;
  const matches = moves.filter((move) => {
    const from = moveFrom(move);
    if (moveTo(move) !== to) return false;
    if (pieceType(pos.board[from]) !== type) return false;
    if (fromFile && FILES[fileOf(from)] !== fromFile) return false;
    if (fromRank && RANKS[rankOf(from)] !== fromRank) return false;
    const movePromotion = movePromo(move);
    if (promo && movePromotion !== promo) return false;
    if (!promo && movePromotion && movePromotion !== QUEEN) return false;
    return true;
  });
  return matches.length === 1 ? matches[0] : 0;
}

// SAN without the check suffix.
function sanBody(pos, move, legal) {
  const from = moveFrom(move);
  const to = moveTo(move);
  const flags = moveFlags(move);
  const piece = pos.board[from];
  const type = pieceType(piece);
  if (flags & FLAG_CASTLE) return fileOf(to) === 6 ? 'O-O' : 'O-O-O';
  if (type === PAWN) {
    let san = '';
    if (flags & FLAG_CAPTURE) san += FILES[fileOf(from)] + 'x';
    san += squareName(to);
    if (flags & FLAG_PROMO) san += '=' + SAN_LETTERS[movePromo(move)];
    return san;
  }
  let san = SAN_LETTERS[type];
  let sameFile = false;
  let sameRank = false;
  let ambiguous = false;
  for (const other of legal) {
    if (other === move) continue;
    const otherFrom = moveFrom(other);
    if (moveTo(other) !== to || otherFrom === from || pos.board[otherFrom] !== piece) continue;
    ambiguous = true;
    if (fileOf(otherFrom) === fileOf(from)) sameFile = true;
    if (rankOf(otherFrom) === rankOf(from)) sameRank = true;
  }
  if (ambiguous) {
    if (!sameFile) san += FILES[fileOf(from)];
    else if (!sameRank) san += RANKS[rankOf(from)];
    else san += squareName(from);
  }
  if (flags & FLAG_CAPTURE) san += 'x';
  return san + squareName(to);
}

