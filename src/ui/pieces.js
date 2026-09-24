// Piece artwork. The "Atelier" set is drawn for this project on a 45x45 grid
// from simple geometric parts (plinth, collar, body, head) so every piece
// shares one silhouette language. The "Glyph" set uses Unicode chess symbols.

const PLINTH = '<rect class="pc-body" x="10" y="36" width="25" height="4.5" rx="1.6"/>';
const COLLAR = '<rect class="pc-body" x="12.5" y="32.5" width="20" height="3.8" rx="1.2"/>';

const SHAPES = {
  p: `
    <circle class="pc-body" cx="22.5" cy="12.5" r="5.2"/>
    <rect class="pc-body" x="17.8" y="17.6" width="9.4" height="2.9" rx="1.3"/>
    <path class="pc-body" d="M19.4 20.5 H25.6 L28.4 32.5 H16.6 Z"/>
    ${COLLAR}${PLINTH}`,

  r: `
    <path class="pc-body" d="M15.2 18 H29.8 L31.2 32.5 H13.8 Z"/>
    <path class="pc-body" d="M12.5 18 V9.5 H16.8 V12.8 H20.4 V9.5 H24.6 V12.8 H28.2 V9.5 H32.5 V18 Z"/>
    <path class="pc-line" d="M15.4 21.5 H29.6 M14.6 29 H30.4"/>
    ${COLLAR}${PLINTH}`,

  n: `
    <path class="pc-body" d="M16 32.5 C16.4 28 18.6 25.2 21.2 22.9 L19.2 22.2 C17.2 24 15.6 25.8 13.6 25.8
      C11.5 25.8 10.3 24.2 10.9 22.4 C12 19.4 15 16.4 17.9 13.5 C19.4 12 20.4 10.4 21.4 7.8 L23.1 10.1
      L25.1 6.4 L26.7 9.7 C31.2 11.2 34.2 16.2 33.7 22.6 C33.4 26.6 32.2 29.6 31.2 32.5 Z"/>
    <path class="pc-line" d="M26.4 11.8 C29.8 14 31.4 18.4 30.9 23.4"/>
    <circle class="pc-eye" cx="20.8" cy="14.6" r="1.25"/>
    <circle class="pc-eye" cx="13.2" cy="22.6" r="0.75"/>
    ${COLLAR}${PLINTH}`,

  b: `
    <circle class="pc-body" cx="22.5" cy="7.6" r="2.3"/>
    <path class="pc-body" d="M22.5 9.9 C16.2 14.6 15.4 20.6 17.6 25.6 H27.4 C29.6 20.6 28.8 14.6 22.5 9.9 Z"/>
    <path class="pc-line" d="M20.6 19 L25.4 13.6"/>
    <rect class="pc-body" x="17.4" y="25.6" width="10.2" height="2.8" rx="1.2"/>
    <path class="pc-body" d="M18.6 28.4 H26.4 L28.6 32.5 H16.4 Z"/>
    ${COLLAR}${PLINTH}`,

  q: `
    <path class="pc-body" d="M12.4 29.5 L9.6 13.4 L14.8 21.2 L16.2 10.2 L20.2 20.6 L22.5 8.6 L24.8 20.6
      L28.8 10.2 L30.2 21.2 L35.4 13.4 L32.6 29.5 Z"/>
    <circle class="pc-body" cx="9.6" cy="12.6" r="2"/>
    <circle class="pc-body" cx="16.2" cy="9.4" r="2"/>
    <circle class="pc-body" cx="22.5" cy="7.6" r="2"/>
    <circle class="pc-body" cx="28.8" cy="9.4" r="2"/>
    <circle class="pc-body" cx="35.4" cy="12.6" r="2"/>
    <path class="pc-line" d="M13.2 26 C19 24.6 26 24.6 31.8 26"/>
    ${COLLAR}${PLINTH}`,

  k: `
    <path class="pc-body" d="M21 4.6 H24 V8 H27.4 V11 H24 V16.4 H21 V11 H17.6 V8 H21 Z"/>
    <path class="pc-body" d="M22.5 29.6 H12.6 C10 24.2 10.8 18.6 16.4 18.4 C19.4 18.3 21.4 20.4 22.5 23
      C23.6 20.4 25.6 18.3 28.6 18.4 C34.2 18.6 35 24.2 32.4 29.6 Z"/>
    <rect class="pc-body" x="20.6" y="16.2" width="3.8" height="5" rx="1"/>
    <path class="pc-line" d="M13.6 26.2 C19 24.8 26 24.8 31.4 26.2"/>
    ${COLLAR}${PLINTH}`,
};

const GLYPHS = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };

const svgCache = new Map();

// Returns SVG markup for a piece. `color` is 'w' or 'b'; `type` one of pnbrqk.
export function pieceSvg(color, type, style = 'atelier') {
  const key = `${style}:${color}${type}`;
  if (svgCache.has(key)) return svgCache.get(key);
  let markup;
  if (style === 'glyph') {
    markup = `<svg viewBox="0 0 45 45" class="piece-svg glyph ${color === 'w' ? 'pc-white' : 'pc-black'}" aria-hidden="true">
      <text x="22.5" y="24" text-anchor="middle" dominant-baseline="central">${GLYPHS[type]}</text></svg>`;
  } else {
    markup = `<svg viewBox="0 0 45 45" class="piece-svg ${color === 'w' ? 'pc-white' : 'pc-black'}" aria-hidden="true">${SHAPES[type]}</svg>`;
  }
  svgCache.set(key, markup);
  return markup;
}

export const PIECE_LABELS = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };

// Piece code (1..6, +8 for black) to { color, type }.
export function decodePiece(code) {
  if (!code) return null;
  return { color: code & 8 ? 'b' : 'w', type: ' pnbrqk'[code & 7] };
}
