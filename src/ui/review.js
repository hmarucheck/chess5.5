// Game review maths and the evaluation graph.
//
// Engine scores are turned into winning chances with a logistic curve, and
// each move is judged by how much winning chance it gave away. This is the
// same idea the big chess sites use, so labels like "Mistake" and the
// accuracy percentage feel familiar.

// A mate score counts as a very large centipawn value, closer mates larger.
export function scoreToCp(score) {
  if (!score) return 0;
  if (score.mate !== undefined) {
    if (score.mate === 0) return score.winner === 'b' ? -10000 : 10000;
    return score.mate > 0 ? 10000 - score.mate * 10 : -10000 - score.mate * 10;
  }
  return score.cp;
}

// Winning chance for White in percent (0..100).
export function winChance(cp) {
  const clamped = Math.max(-2000, Math.min(2000, cp));
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * clamped)) - 1);
}

// Accuracy of a single move from the winning chance it lost (0..100).
export function moveAccuracy(winBefore, winAfter) {
  const loss = Math.max(0, winBefore - winAfter);
  const raw = 103.1668 * Math.exp(-0.04354 * loss) - 3.1669;
  return Math.max(0, Math.min(100, raw + 1));
}

export const CLASSIFICATIONS = {
  book: { label: 'Book', symbol: '', tone: 'book' },
  best: { label: 'Best', symbol: '', tone: 'best' },
  excellent: { label: 'Excellent', symbol: '', tone: 'good' },
  good: { label: 'Good', symbol: '', tone: 'good' },
  inaccuracy: { label: 'Inaccuracy', symbol: '?!', tone: 'inaccuracy' },
  mistake: { label: 'Mistake', symbol: '?', tone: 'mistake' },
  blunder: { label: 'Blunder', symbol: '??', tone: 'blunder' },
  forced: { label: 'Only move', symbol: '', tone: 'good' },
};

// Classifies each move of a reviewed game.
//   evals[i]      white-perspective score of the position after i plies
//   bestMoves[i]  engine's best move (UCI) in the position after i plies
//   history       the game's move records
//   inBook(i)     whether move i came from the opening book
//   legalCounts   number of legal moves before each move
export function classifyGame({ evals, bestMoves, history, inBook, legalCounts }) {
  const moves = [];
  const totals = { w: [], b: [] };
  for (let i = 0; i < history.length; i++) {
    const record = history[i];
    const mover = record.color;
    const before = scoreToCp(evals[i]);
    const after = scoreToCp(evals[i + 1]);
    const winBeforeWhite = winChance(before);
    const winAfterWhite = winChance(after);
    const winBefore = mover === 'w' ? winBeforeWhite : 100 - winBeforeWhite;
    const winAfter = mover === 'w' ? winAfterWhite : 100 - winAfterWhite;
    const loss = Math.max(0, winBefore - winAfter);
    const accuracy = moveAccuracy(winBefore, winAfter);

    let kind;
    if (inBook && inBook(i)) kind = 'book';
    else if (legalCounts && legalCounts[i] === 1) kind = 'forced';
    else if (bestMoves[i] && bestMoves[i] === record.uci) kind = 'best';
    else if (loss >= 20) kind = 'blunder';
    else if (loss >= 10) kind = 'mistake';
    else if (loss >= 5) kind = 'inaccuracy';
    else if (loss < 1.5) kind = 'excellent';
    else kind = 'good';

    // Missing a mate or allowing one is always at least a mistake.
    if (kind !== 'book' && kind !== 'forced' && kind !== 'best') {
      const hadMate = mover === 'w' ? before >= 9000 : before <= -9000;
      const nowMate = mover === 'w' ? after >= 9000 : after <= -9000;
      const allowsMate = mover === 'w' ? after <= -9000 : after >= 9000;
      if (hadMate && !nowMate && kind !== 'blunder') kind = 'mistake';
      if (allowsMate && !(mover === 'w' ? before <= -9000 : before >= 9000)) kind = 'blunder';
    }

    moves.push({ ply: i + 1, kind, loss, accuracy, winAfterWhite, cpAfter: after, best: bestMoves[i] });
    if (kind !== 'book') totals[mover].push(accuracy);
  }

  const summarize = (color) => {
    const list = totals[color];
    const counts = {};
    for (const key of Object.keys(CLASSIFICATIONS)) counts[key] = 0;
    moves.forEach((m, i) => { if (history[i].color === color) counts[m.kind]++; });
    // Harmonic-leaning mean: punishes a few big errors more than a plain average.
    let accuracy = null;
    if (list.length) {
      const mean = list.reduce((a, b) => a + b, 0) / list.length;
      const harmonic = list.length / list.reduce((a, b) => a + 1 / Math.max(b, 5), 0);
      accuracy = Math.round(((mean + harmonic) / 2) * 10) / 10;
    }
    return { accuracy, counts };
  };

  return { moves, white: summarize('w'), black: summarize('b') };
}

// Builds the evaluation graph as SVG markup. `points` are White winning
// chances (0..100) for plies 0..N; `marks` flags plies with errors.
export function evalGraphSvg(points, { width = 600, height = 120, currentPly = null, marks = [] } = {}) {
  if (points.length < 2) {
    return `<svg viewBox="0 0 ${width} ${height}" class="eval-graph" role="img" aria-label="Evaluation graph"></svg>`;
  }
  const stepX = width / (points.length - 1);
  const y = (p) => height - (p / 100) * height;
  const line = points.map((p, i) => `${(i * stepX).toFixed(1)},${y(p).toFixed(1)}`).join(' ');
  const area = `0,${height} ${line} ${width},${height}`;
  const markup = [
    `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" class="eval-graph" role="img" aria-label="Evaluation over the game">`,
    `<rect x="0" y="0" width="${width}" height="${height}" class="eg-bg"/>`,
    `<polygon points="${area}" class="eg-area"/>`,
    `<line x1="0" y1="${height / 2}" x2="${width}" y2="${height / 2}" class="eg-mid"/>`,
    `<polyline points="${line}" class="eg-line" fill="none"/>`,
  ];
  for (const mark of marks) {
    const cx = mark.ply * stepX;
    markup.push(`<circle cx="${cx.toFixed(1)}" cy="${y(points[mark.ply]).toFixed(1)}" r="4" class="eg-mark eg-${mark.kind}"/>`);
  }
  if (currentPly !== null && currentPly >= 0 && currentPly < points.length) {
    const cx = currentPly * stepX;
    markup.push(`<line x1="${cx.toFixed(1)}" y1="0" x2="${cx.toFixed(1)}" y2="${height}" class="eg-cursor"/>`);
  }
  markup.push('</svg>');
  return markup.join('');
}

// Formats a score object for display: "+1.25", "-0.40", "#3", "#-2".
export function formatScore(score, { perspective = 'w' } = {}) {
  if (!score) return '–';
  if (score.mate !== undefined) {
    if (score.mate === 0) return score.winner ? (score.winner === 'w' ? '1-0' : '0-1') : '#';
    const m = perspective === 'w' ? score.mate : -score.mate;
    return m > 0 ? `#${m}` : `#-${Math.abs(m)}`;
  }
  const cp = perspective === 'w' ? score.cp : -score.cp;
  const value = (cp / 100).toFixed(2);
  return cp > 0 ? `+${value}` : value === '-0.00' ? '0.00' : value;
}
