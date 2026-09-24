// Local persistence for settings and the game in progress. Storage can be
// unavailable (private windows, blocked site data), so every access is
// guarded and the app works without it.

const PREFIX = 'chess55.';

export function loadJson(key, fallback = null) {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function saveJson(key, value) {
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function removeKey(key) {
  try {
    window.localStorage.removeItem(PREFIX + key);
  } catch {
    // Nothing to do: storage is unavailable.
  }
}

export const DEFAULT_SETTINGS = {
  boardTheme: 'walnut',
  pieceStyle: 'atelier',
  showDests: true,
  showCoords: true,
  highlightLastMove: true,
  animation: 'normal',
  sound: true,
  volume: 0.6,
  autoQueen: false,
  showEvalBar: true,
  figurines: false,
  confirmResign: true,
};

export function loadSettings() {
  return { ...DEFAULT_SETTINGS, ...loadJson('settings', {}) };
}

export function saveSettings(settings) {
  saveJson('settings', settings);
}

export function loadStats() {
  return { wins: 0, losses: 0, draws: 0, byLevel: {}, ...loadJson('stats', {}) };
}

// Records a finished game against the computer.
export function recordResult(stats, level, outcome) {
  const next = { ...stats, byLevel: { ...stats.byLevel } };
  const entry = { wins: 0, losses: 0, draws: 0, ...(next.byLevel[level] || {}) };
  const key = outcome === 'win' ? 'wins' : outcome === 'loss' ? 'losses' : 'draws';
  next[key]++;
  entry[key]++;
  next.byLevel[level] = entry;
  saveJson('stats', next);
  return next;
}
