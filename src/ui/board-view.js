// BoardView: renders a position and handles every board interaction.
//
// Features: click-to-move and drag-and-drop (mouse, pen and touch through
// pointer events), legal-move hints, last-move and check highlights,
// animated transitions between any two positions, right-click arrows and
// square marks, engine arrows, a promotion picker, and board flipping.
//
// Squares are indexed 0..63 with a1 = 0 and h8 = 63.

import { pieceSvg, decodePiece, PIECE_LABELS } from './pieces.js';

const FILE_NAMES = 'abcdefgh';

export function indexToName(index) {
  return FILE_NAMES[index & 7] + ((index >> 3) + 1);
}

export function nameToIndex(name) {
  return (Number(name[1]) - 1) * 8 + FILE_NAMES.indexOf(name[0]);
}

// Board array (64 piece codes) from the placement field of a FEN.
export function boardFromFen(fen) {
  const board = new Int8Array(64);
  const rows = fen.split(' ')[0].split('/');
  const codes = { p: 1, n: 2, b: 3, r: 4, q: 5, k: 6 };
  rows.forEach((row, i) => {
    const rank = 7 - i;
    let file = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) { file += Number(ch); continue; }
      const lower = ch.toLowerCase();
      board[rank * 8 + file] = codes[lower] | (ch === lower ? 8 : 0);
      file++;
    }
  });
  return board;
}

const ARROW_COLORS = {
  green: 'var(--arrow-green)',
  red: 'var(--arrow-red)',
  blue: 'var(--arrow-blue)',
  yellow: 'var(--arrow-yellow)',
  engine: 'var(--arrow-engine)',
  hint: 'var(--arrow-hint)',
};

export class BoardView {
  constructor(root, callbacks = {}) {
    this.root = root;
    this.callbacks = callbacks;
    this.orientation = 'w';
    this.board = new Int8Array(64);
    this.pieceEls = new Map(); // square index -> element
    this.pieceStyle = 'atelier';
    this.showDests = true;
    this.showCoords = true;
    this.animationMs = 200;
    this.selected = -1;
    this.dests = [];
    this.lastMove = null;
    this.checkSquare = -1;
    this.userArrows = [];
    this.userMarks = new Set();
    this.systemArrows = [];
    this.drag = null;
    this.rightDrag = null;
    this.promotionState = null;
    this.interactive = true;
    this.build();
  }

  // ---------------------------------------------------------------------------
  // DOM construction
  // ---------------------------------------------------------------------------

  build() {
    this.root.classList.add('board');
    this.root.innerHTML = '';
    this.root.setAttribute('role', 'grid');
    this.root.setAttribute('aria-label', 'Chess board');

    this.squaresEl = document.createElement('div');
    this.squaresEl.className = 'board-squares';
    this.squareEls = [];
    for (let i = 0; i < 64; i++) {
      const sq = document.createElement('div');
      sq.className = 'sq';
      this.squareEls.push(sq);
    }

    this.piecesEl = document.createElement('div');
    this.piecesEl.className = 'board-pieces';

    this.svgNs = 'http://www.w3.org/2000/svg';
    this.arrowsEl = document.createElementNS(this.svgNs, 'svg');
    this.arrowsEl.setAttribute('class', 'board-arrows');
    this.arrowsEl.setAttribute('viewBox', '0 0 800 800');
    this.arrowsEl.setAttribute('aria-hidden', 'true');

    this.overlayEl = document.createElement('div');
    this.overlayEl.className = 'board-overlay';

    this.root.append(this.squaresEl, this.piecesEl, this.arrowsEl, this.overlayEl);
    this.layoutSquares();

    this.onPointerDown = this.onPointerDown.bind(this);
    this.onPointerMove = this.onPointerMove.bind(this);
    this.onPointerUp = this.onPointerUp.bind(this);
    this.root.addEventListener('pointerdown', this.onPointerDown);
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', () => this.cancelDrag());
  }

  // Places square elements in visual order for the current orientation and
  // writes the edge coordinates.
  layoutSquares() {
    this.squaresEl.innerHTML = '';
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const index = this.visualToIndex(col, row);
        const el = this.squareEls[index];
        const file = index & 7;
        const rank = index >> 3;
        el.className = `sq ${(file + rank) % 2 === 0 ? 'dark' : 'light'}`;
        el.dataset.square = indexToName(index);
        el.innerHTML = '';
        if (this.showCoords) {
          if (col === 0) el.insertAdjacentHTML('beforeend', `<span class="coord coord-rank">${rank + 1}</span>`);
          if (row === 7) el.insertAdjacentHTML('beforeend', `<span class="coord coord-file">${FILE_NAMES[file]}</span>`);
        }
        this.squaresEl.appendChild(el);
      }
    }
    this.refreshHighlights();
  }

  visualToIndex(col, row) {
    return this.orientation === 'w' ? (7 - row) * 8 + col : row * 8 + (7 - col);
  }

  indexToVisual(index) {
    const file = index & 7;
    const rank = index >> 3;
    return this.orientation === 'w' ? { col: file, row: 7 - rank } : { col: 7 - file, row: rank };
  }

  squareFromPoint(clientX, clientY) {
    const rect = this.root.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    if (x < 0 || y < 0 || x >= rect.width || y >= rect.height) return -1;
    const col = Math.floor((x / rect.width) * 8);
    const row = Math.floor((y / rect.height) * 8);
    return this.visualToIndex(col, row);
  }

  // ---------------------------------------------------------------------------
  // Settings
  // ---------------------------------------------------------------------------

  setOrientation(color) {
    if (color === this.orientation) return;
    this.orientation = color;
    this.root.classList.toggle('flipped', color === 'b');
    this.layoutSquares();
    this.placeAllPieces(false);
    this.renderArrows();
    this.closePromotion(null);
  }

  flip() {
    this.setOrientation(this.orientation === 'w' ? 'b' : 'w');
  }

  setPieceStyle(style) {
    if (style === this.pieceStyle) return;
    this.pieceStyle = style;
    for (const [square, el] of this.pieceEls) {
      const piece = decodePiece(this.board[square]);
      if (piece) el.innerHTML = pieceSvg(piece.color, piece.type, style);
    }
  }

  setShowCoords(show) {
    this.showCoords = show;
    this.layoutSquares();
  }

  setShowDests(show) {
    this.showDests = show;
    this.refreshHighlights();
  }

  setAnimationMs(ms) {
    this.animationMs = ms;
    this.root.style.setProperty('--anim-ms', `${ms}ms`);
  }

  setInteractive(value) {
    this.interactive = value;
    if (!value) this.clearSelection();
  }

  // ---------------------------------------------------------------------------
  // Pieces
  // ---------------------------------------------------------------------------

  placeElement(el, square, animate) {
    const { col, row } = this.indexToVisual(square);
    el.style.transition = animate && this.animationMs > 0 ? '' : 'none';
    el.style.transform = `translate(${col * 100}%, ${row * 100}%)`;
    el.dataset.square = indexToName(square);
    if (!animate) {
      // Force the no-transition placement to apply before re-enabling transitions.
      void el.offsetWidth;
      el.style.transition = '';
    }
  }

  placeAllPieces(animate) {
    for (const [square, el] of this.pieceEls) this.placeElement(el, square, animate);
  }

  createPieceElement(code) {
    const piece = decodePiece(code);
    const el = document.createElement('div');
    el.className = `piece piece-${piece.color}`;
    el.dataset.type = piece.type;
    el.innerHTML = pieceSvg(piece.color, piece.type, this.pieceStyle);
    el.setAttribute('aria-label', `${piece.color === 'w' ? 'White' : 'Black'} ${PIECE_LABELS[piece.type]}`);
    return el;
  }

  // Shows a new position. Pieces that exist in both positions keep their
  // element and glide to their new square, so any jump (a move, a takeback,
  // or skipping through history) animates naturally.
  setPosition(board, { animate = true } = {}) {
    const doAnimate = animate && this.animationMs > 0 && !document.hidden;
    const oldEls = this.pieceEls;
    const oldBoard = this.board;
    const next = new Map();
    const unmatchedOld = new Map(); // square -> el
    const needed = [];

    for (let sq = 0; sq < 64; sq++) {
      const code = board[sq];
      if (code && oldBoard[sq] === code && oldEls.has(sq)) {
        next.set(sq, oldEls.get(sq));
      } else if (code) {
        needed.push(sq);
      }
    }
    for (const [sq, el] of oldEls) {
      if (next.get(sq) !== el) unmatchedOld.set(sq, el);
    }

    // Pair each needed square with the nearest unmatched element of the same piece.
    for (const sq of needed) {
      const code = board[sq];
      let bestSq = -1;
      let bestDist = Infinity;
      for (const [oldSq] of unmatchedOld) {
        if (oldBoard[oldSq] !== code) continue;
        const dist = Math.abs((oldSq & 7) - (sq & 7)) + Math.abs((oldSq >> 3) - (sq >> 3));
        if (dist < bestDist) {
          bestDist = dist;
          bestSq = oldSq;
        }
      }
      if (bestSq >= 0) {
        const el = unmatchedOld.get(bestSq);
        unmatchedOld.delete(bestSq);
        next.set(sq, el);
        el.classList.add('moving');
        this.placeElement(el, sq, doAnimate);
        setTimeout(() => el.classList.remove('moving'), this.animationMs + 30);
      } else {
        const el = this.createPieceElement(code);
        this.placeElement(el, sq, false);
        if (doAnimate) el.classList.add('appearing');
        this.piecesEl.appendChild(el);
        next.set(sq, el);
        if (doAnimate) setTimeout(() => el.classList.remove('appearing'), this.animationMs + 30);
      }
    }

    // Anything left was captured or removed.
    for (const [, el] of unmatchedOld) {
      if (doAnimate) {
        el.classList.add('vanishing');
        setTimeout(() => el.remove(), this.animationMs + 30);
      } else {
        el.remove();
      }
    }

    // Promotions reuse the pawn's element but need new artwork.
    for (const [sq, el] of next) {
      const piece = decodePiece(board[sq]);
      const wanted = `piece piece-${piece.color}`;
      if (!el.className.startsWith(wanted) || el.dataset.type !== piece.type) {
        el.dataset.type = piece.type;
        el.className = el.className.replace(/piece piece-[wb]/, wanted);
        el.innerHTML = pieceSvg(piece.color, piece.type, this.pieceStyle);
        el.setAttribute('aria-label', `${piece.color === 'w' ? 'White' : 'Black'} ${PIECE_LABELS[piece.type]}`);
      }
    }

    this.pieceEls = next;
    this.board = Int8Array.from(board);
    if (this.selected >= 0 && !this.board[this.selected]) this.clearSelection();
  }

  // ---------------------------------------------------------------------------
  // Highlights
  // ---------------------------------------------------------------------------

  setLastMove(from, to) {
    this.lastMove = from === null || from === undefined ? null : { from, to };
    this.refreshHighlights();
  }

  setCheck(square) {
    this.checkSquare = square;
    this.refreshHighlights();
  }

  refreshHighlights() {
    const destSet = new Map(this.dests.map((d) => [d.to, d]));
    for (let i = 0; i < 64; i++) {
      const el = this.squareEls[i];
      el.classList.toggle('last-move', !!this.lastMove && (this.lastMove.from === i || this.lastMove.to === i));
      el.classList.toggle('selected', this.selected === i);
      el.classList.toggle('in-check', this.checkSquare === i);
      const dest = this.showDests ? destSet.get(i) : null;
      el.classList.toggle('dest', !!dest && !dest.capture);
      el.classList.toggle('dest-capture', !!dest && dest.capture);
      el.classList.toggle('marked', this.userMarks.has(i));
    }
  }

  select(square) {
    this.selected = square;
    this.dests = this.callbacks.getDests ? this.callbacks.getDests(square) : [];
    this.refreshHighlights();
  }

  clearSelection() {
    this.selected = -1;
    this.dests = [];
    this.refreshHighlights();
  }

  // ---------------------------------------------------------------------------
  // Arrows and marks
  // ---------------------------------------------------------------------------

  setSystemArrows(arrows) {
    this.systemArrows = arrows || [];
    this.renderArrows();
  }

  clearUserAnnotations() {
    if (!this.userArrows.length && !this.userMarks.size) return;
    this.userArrows = [];
    this.userMarks.clear();
    this.renderArrows();
    this.refreshHighlights();
  }

  squareCenter(index) {
    const { col, row } = this.indexToVisual(index);
    return { x: col * 100 + 50, y: row * 100 + 50 };
  }

  arrowPolygon(from, to, width = 16, headWidth = 42, headLength = 38) {
    const a = this.squareCenter(from);
    const b = this.squareCenter(to);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    const ux = dx / len;
    const uy = dy / len;
    const px = -uy;
    const py = ux;
    const start = { x: a.x + ux * 20, y: a.y + uy * 20 };
    const tip = { x: b.x - ux * 12, y: b.y - uy * 12 };
    const neck = { x: tip.x - ux * headLength, y: tip.y - uy * headLength };
    const hw = width / 2;
    const hh = headWidth / 2;
    const pts = [
      [start.x + px * hw, start.y + py * hw],
      [neck.x + px * hw, neck.y + py * hw],
      [neck.x + px * hh, neck.y + py * hh],
      [tip.x, tip.y],
      [neck.x - px * hh, neck.y - py * hh],
      [neck.x - px * hw, neck.y - py * hw],
      [start.x - px * hw, start.y - py * hw],
    ];
    return pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  }

  renderArrows() {
    const parts = [];
    const all = [...this.systemArrows, ...this.userArrows];
    if (this.rightDrag && this.rightDrag.to >= 0 && this.rightDrag.to !== this.rightDrag.from) {
      all.push({ from: this.rightDrag.from, to: this.rightDrag.to, color: this.rightDrag.color, preview: true });
    }
    for (const arrow of all) {
      if (arrow.from === arrow.to) continue;
      const color = ARROW_COLORS[arrow.color] || ARROW_COLORS.green;
      const opacity = arrow.opacity ?? (arrow.preview ? 0.55 : 0.8);
      const scale = arrow.weight || 1;
      parts.push(`<polygon points="${this.arrowPolygon(arrow.from, arrow.to, 16 * scale, 42 * scale, 36 * scale)}" fill="${color}" opacity="${opacity}"/>`);
    }
    for (const mark of this.userMarks) {
      const c = this.squareCenter(mark);
      parts.push(`<circle cx="${c.x}" cy="${c.y}" r="44" fill="none" stroke="${ARROW_COLORS.green}" stroke-width="7" opacity="0.8"/>`);
    }
    this.arrowsEl.innerHTML = parts.join('');
  }

  // ---------------------------------------------------------------------------
  // Pointer handling
  // ---------------------------------------------------------------------------

  arrowColorFor(event) {
    if (event.shiftKey) return 'red';
    if (event.altKey) return 'blue';
    if (event.ctrlKey || event.metaKey) return 'yellow';
    return 'green';
  }

  onPointerDown(event) {
    if (this.promotionState) return;
    const square = this.squareFromPoint(event.clientX, event.clientY);
    if (square < 0) return;

    if (event.button === 2) {
      event.preventDefault();
      this.rightDrag = { from: square, to: square, color: this.arrowColorFor(event) };
      return;
    }
    if (event.button !== 0) return;
    this.clearUserAnnotations();
    if (this.callbacks.onBoardClick) this.callbacks.onBoardClick(square);
    if (!this.interactive) return;

    // Second click of click-to-move.
    if (this.selected >= 0 && square !== this.selected && this.dests.some((d) => d.to === square)) {
      const from = this.selected;
      this.clearSelection();
      this.tryMove(from, square, true);
      return;
    }

    const canPick = this.board[square] && this.callbacks.canPick && this.callbacks.canPick(square);
    if (!canPick) {
      this.clearSelection();
      return;
    }

    const wasSelected = this.selected === square;
    this.select(square);
    const el = this.pieceEls.get(square);
    if (!el) return;
    event.preventDefault();
    const rect = this.root.getBoundingClientRect();
    this.drag = {
      from: square,
      el,
      startX: event.clientX,
      startY: event.clientY,
      rect,
      active: false,
      wasSelected,
      hover: -1,
      pointerId: event.pointerId,
    };
  }

  onPointerMove(event) {
    if (this.rightDrag) {
      const square = this.squareFromPoint(event.clientX, event.clientY);
      if (square !== this.rightDrag.to) {
        this.rightDrag.to = square;
        this.renderArrows();
      }
      return;
    }
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (!drag.active) {
      if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 4) return;
      drag.active = true;
      drag.rect = this.root.getBoundingClientRect();
      drag.el.classList.add('dragging');
      this.root.classList.add('is-dragging');
    }
    const size = drag.rect.width / 8;
    const x = event.clientX - drag.rect.left - size / 2;
    const y = event.clientY - drag.rect.top - size / 2;
    drag.el.style.transition = 'none';
    drag.el.style.transform = `translate(${x}px, ${y}px)`;
    const hover = this.squareFromPoint(event.clientX, event.clientY);
    if (hover !== drag.hover) {
      if (drag.hover >= 0) this.squareEls[drag.hover].classList.remove('drag-over');
      if (hover >= 0) this.squareEls[hover].classList.add('drag-over');
      drag.hover = hover;
    }
  }

  onPointerUp(event) {
    if (this.rightDrag && event.button === 2) {
      const { from, color } = this.rightDrag;
      const to = this.squareFromPoint(event.clientX, event.clientY);
      this.rightDrag = null;
      if (to >= 0) this.toggleAnnotation(from, to, color);
      else this.renderArrows();
      return;
    }
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    this.drag = null;
    this.root.classList.remove('is-dragging');
    drag.el.classList.remove('dragging');
    if (drag.hover >= 0) this.squareEls[drag.hover].classList.remove('drag-over');

    if (!drag.active) {
      // A plain click on an already-selected piece toggles the selection off.
      if (drag.wasSelected) this.clearSelection();
      return;
    }
    const to = this.squareFromPoint(event.clientX, event.clientY);
    if (to >= 0 && to !== drag.from && this.dests.some((d) => d.to === to)) {
      this.clearSelection();
      // Snap the dragged piece onto the target without an animation.
      this.placeElement(drag.el, to, false);
      this.tryMove(drag.from, to, false);
    } else {
      this.placeElement(drag.el, drag.from, true);
      if (to === drag.from) return; // keep it selected for click-to-move
      this.clearSelection();
    }
  }

  cancelDrag() {
    if (this.drag) {
      this.placeElement(this.drag.el, this.drag.from, true);
      this.drag.el.classList.remove('dragging');
      this.drag = null;
      this.root.classList.remove('is-dragging');
    }
    this.rightDrag = null;
  }

  toggleAnnotation(from, to, color) {
    if (from === to) {
      if (this.userMarks.has(from)) this.userMarks.delete(from);
      else this.userMarks.add(from);
      this.refreshHighlights();
    } else {
      const existing = this.userArrows.findIndex((a) => a.from === from && a.to === to);
      if (existing >= 0 && this.userArrows[existing].color === color) this.userArrows.splice(existing, 1);
      else if (existing >= 0) this.userArrows[existing].color = color;
      else this.userArrows.push({ from, to, color });
    }
    this.renderArrows();
  }

  async tryMove(from, to, animate) {
    if (!this.callbacks.onMove) return;
    const accepted = await this.callbacks.onMove(from, to, { animate });
    if (!accepted) {
      // Put the piece back where it belongs.
      const el = this.pieceEls.get(from);
      if (el) this.placeElement(el, from, true);
    }
  }

  // ---------------------------------------------------------------------------
  // Promotion picker
  // ---------------------------------------------------------------------------

  // Shows the four promotion choices over the promotion square's file and
  // resolves with 'q' | 'r' | 'b' | 'n', or null if dismissed.
  choosePromotion(square, color) {
    this.closePromotion(null);
    return new Promise((resolve) => {
      const { col, row } = this.indexToVisual(square);
      const downward = row === 0;
      const picker = document.createElement('div');
      picker.className = 'promotion-picker';
      picker.style.left = `${col * 12.5}%`;
      picker.style.top = downward ? '0' : 'auto';
      picker.style.bottom = downward ? 'auto' : '0';
      picker.setAttribute('role', 'dialog');
      picker.setAttribute('aria-label', 'Choose promotion piece');
      const types = ['q', 'n', 'r', 'b'];
      const ordered = downward ? types : types.slice().reverse();
      for (const type of ordered) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'promotion-choice';
        btn.innerHTML = pieceSvg(color, type, this.pieceStyle);
        btn.setAttribute('aria-label', `Promote to ${PIECE_LABELS[type]}`);
        btn.addEventListener('pointerdown', (e) => e.stopPropagation());
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.closePromotion(type);
        });
        picker.appendChild(btn);
      }
      const backdrop = document.createElement('div');
      backdrop.className = 'promotion-backdrop';
      backdrop.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        this.closePromotion(null);
      });
      this.overlayEl.append(backdrop, picker);
      this.promotionState = { resolve, picker, backdrop };
      picker.querySelector('button').focus();
    });
  }

  closePromotion(choice) {
    const state = this.promotionState;
    if (!state) return;
    this.promotionState = null;
    state.picker.remove();
    state.backdrop.remove();
    state.resolve(choice);
  }

  // Brief shake used when an illegal move is attempted from the keyboard box.
  flash(square) {
    const el = this.squareEls[square];
    if (!el) return;
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
  }
}
