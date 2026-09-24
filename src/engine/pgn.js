// Portable Game Notation: export a Game, and import PGN text (headers,
// comments, NAGs and variations are tolerated; the main line is replayed).

import { START_FEN } from './constants.js';
import { Game, RESULT_NONE, RESULT_WHITE, RESULT_BLACK, RESULT_DRAW, REASONS } from './game.js';

const SEVEN_TAG_ROSTER = ['Event', 'Site', 'Date', 'Round', 'White', 'Black', 'Result'];

export class PgnError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PgnError';
  }
}

function pgnDate(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())}`;
}

function escapeHeader(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

// Wraps movetext tokens at `width` columns as the PGN standard recommends.
function wrapTokens(tokens, width = 80) {
  const lines = [];
  let line = '';
  for (const token of tokens) {
    if (line && line.length + 1 + token.length > width) {
      lines.push(line);
      line = token;
    } else {
      line = line ? `${line} ${token}` : token;
    }
  }
  if (line) lines.push(line);
  return lines.join('\n');
}

export function formatClock(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function exportPgn(game, extraHeaders = {}) {
  const headers = {
    Event: 'Casual game',
    Site: 'Chess 5.5',
    Date: pgnDate(),
    Round: '-',
    White: 'White',
    Black: 'Black',
    ...game.headers,
    ...extraHeaders,
    Result: game.result,
  };
  if (game.startFen !== START_FEN) {
    headers.SetUp = '1';
    headers.FEN = game.startFen;
  }
  if (game.reason && !headers.Termination) {
    const termination = {
      [REASONS.timeout]: 'time forfeit',
      [REASONS.timeoutDraw]: 'time forfeit',
      [REASONS.abandoned]: 'abandoned',
    }[game.reason];
    headers.Termination = termination || 'normal';
  }

  const lines = [];
  for (const key of SEVEN_TAG_ROSTER) lines.push(`[${key} "${escapeHeader(headers[key] ?? '?')}"]`);
  for (const [key, value] of Object.entries(headers)) {
    if (SEVEN_TAG_ROSTER.includes(key) || value === undefined || value === null || value === '') continue;
    lines.push(`[${key} "${escapeHeader(value)}"]`);
  }

  const tokens = [];
  game.history.forEach((record, index) => {
    const whiteToMove = record.color === 'w';
    if (whiteToMove) tokens.push(`${record.moveNumber}.`);
    else if (index === 0) tokens.push(`${record.moveNumber}...`);
    tokens.push(record.san + (record.annotation || ''));
    const notes = [];
    if (record.clock !== null && record.clock !== undefined) notes.push(`[%clk ${formatClock(record.clock)}]`);
    if (record.eval !== null && record.eval !== undefined) notes.push(`[%eval ${record.eval}]`);
    if (record.comment) notes.push(record.comment.replace(/[{}]/g, ''));
    if (notes.length) tokens.push(`{ ${notes.join(' ')} }`);
  });
  tokens.push(game.result);

  return `${lines.join('\n')}\n\n${wrapTokens(tokens)}\n`;
}

// Splits PGN text containing several games into single-game chunks.
export function splitPgnGames(text) {
  const games = [];
  let current = [];
  let seenMoves = false;
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    const isHeader = /^\s*\[/.test(line);
    if (isHeader && seenMoves) {
      games.push(current.join('\n'));
      current = [];
      seenMoves = false;
    }
    if (!isHeader && line.trim()) seenMoves = true;
    current.push(line);
  }
  if (current.join('').trim()) games.push(current.join('\n'));
  return games;
}

export function parsePgnHeaders(text) {
  const headers = {};
  const re = /^\s*\[\s*(\w+)\s+"((?:[^"\\]|\\.)*)"\s*\]\s*$/gm;
  let m;
  while ((m = re.exec(text))) headers[m[1]] = m[2].replace(/\\(["\\])/g, '$1');
  return headers;
}

// Tokenizes movetext, dropping comments, variations, NAGs and move numbers,
// but keeping the comment attached to the preceding move.
export function tokenizeMovetext(text) {
  const tokens = [];
  let i = 0;
  let depth = 0;
  const len = text.length;
  while (i < len) {
    const ch = text[i];
    if (ch === '{') {
      const end = text.indexOf('}', i + 1);
      const comment = text.slice(i + 1, end < 0 ? len : end).trim();
      if (depth === 0 && tokens.length) {
        const last = tokens[tokens.length - 1];
        if (last.type === 'move') last.comment = last.comment ? `${last.comment} ${comment}` : comment;
      }
      i = end < 0 ? len : end + 1;
      continue;
    }
    if (ch === ';') {
      const end = text.indexOf('\n', i);
      i = end < 0 ? len : end + 1;
      continue;
    }
    if (ch === '(') { depth++; i++; continue; }
    if (ch === ')') { depth = Math.max(0, depth - 1); i++; continue; }
    if (/\s/.test(ch)) { i++; continue; }
    // Line starting with % is an escape per the spec.
    if (ch === '%' && (i === 0 || text[i - 1] === '\n')) {
      const end = text.indexOf('\n', i);
      i = end < 0 ? len : end + 1;
      continue;
    }
    let j = i;
    while (j < len && !/[\s{}();]/.test(text[j])) j++;
    const word = text.slice(i, j);
    i = j;
    if (depth > 0) continue;
    if (/^\$\d+$/.test(word)) continue; // NAG
    if (/^(1-0|0-1|1\/2-1\/2|\*)$/.test(word)) {
      tokens.push({ type: 'result', value: word });
      continue;
    }
    // Strip move numbers such as "12." or "12..." which may be glued to a move.
    const stripped = word.replace(/^\d+\.+/, '');
    if (!stripped) continue;
    const annotation = (/[!?]+$/.exec(stripped) || [''])[0];
    tokens.push({ type: 'move', value: stripped.replace(/[!?]+$/, ''), annotation, comment: null });
  }
  return tokens;
}

function parseClockComment(comment) {
  if (!comment) return null;
  const m = /\[%clk\s+(\d+):(\d+):(\d+(?:\.\d+)?)\]/.exec(comment);
  if (!m) return null;
  return ((Number(m[1]) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000;
}

function stripCommands(comment) {
  if (!comment) return null;
  const cleaned = comment.replace(/\[%[^\]]*\]/g, '').trim();
  return cleaned || null;
}

export function importPgn(text) {
  if (typeof text !== 'string' || !text.trim()) throw new PgnError('The PGN is empty.');
  const [first] = splitPgnGames(text);
  const headers = parsePgnHeaders(first);
  const movetext = first.replace(/^\s*\[.*\]\s*$/gm, '');

  const fen = headers.SetUp === '1' || headers.FEN ? headers.FEN || START_FEN : START_FEN;
  let game;
  try {
    game = new Game(fen);
  } catch (err) {
    throw new PgnError(`The FEN header is invalid: ${err.message}`);
  }

  let result = headers.Result || RESULT_NONE;
  for (const token of tokenizeMovetext(movetext)) {
    if (token.type === 'result') {
      result = token.value;
      continue;
    }
    const record = game.move(token.value, { allowAfterEnd: true });
    if (!record) {
      const moveNo = Math.floor(game.ply / 2) + 1;
      const side = game.turn === 0 ? '' : '...';
      throw new PgnError(`Move ${moveNo}.${side} ${token.value} is not legal in this position.`);
    }
    record.annotation = token.annotation || '';
    record.clock = parseClockComment(token.comment);
    record.comment = stripCommands(token.comment);
  }

  game.headers = { ...headers };
  delete game.headers.Result;
  if (!game.isOver && result !== RESULT_NONE) {
    // Result decided off the board: infer the most likely reason.
    const termination = (headers.Termination || '').toLowerCase();
    if (result === RESULT_DRAW) game.setResult(RESULT_DRAW, REASONS.agreement);
    else if (termination.includes('time')) game.setResult(result, REASONS.timeout);
    else if (result === RESULT_WHITE || result === RESULT_BLACK) game.setResult(result, REASONS.resignation);
  }
  return game;
}
