// Transposition table: remembers search results by position hash so the
// engine never searches the same position twice at the same depth, and so the
// best move from a previous iteration is tried first.

export const TT_EXACT = 1;
export const TT_LOWER = 2; // score is a lower bound (fail high)
export const TT_UPPER = 3; // score is an upper bound (fail low)

export class TranspositionTable {
  constructor(sizeMb = 16) {
    // Each entry uses 4 + 4 + 4 + 1 + 1 + 1 = 15 bytes across the parallel arrays.
    const entries = Math.max(1 << 12, (sizeMb * 1024 * 1024) / 15);
    const bits = Math.floor(Math.log2(entries));
    this.size = 1 << bits;
    this.mask = this.size - 1;
    this.keys = new Int32Array(this.size);
    this.moves = new Int32Array(this.size);
    this.scores = new Int32Array(this.size);
    this.depths = new Int8Array(this.size);
    this.flags = new Uint8Array(this.size);
    this.ages = new Uint8Array(this.size);
    this.age = 0;
    this.used = 0;
  }

  clear() {
    this.keys.fill(0);
    this.moves.fill(0);
    this.scores.fill(0);
    this.depths.fill(0);
    this.flags.fill(0);
    this.ages.fill(0);
    this.used = 0;
    this.age = 0;
  }

  // Called once per new search so stale entries lose replacement priority.
  newSearch() {
    this.age = (this.age + 1) & 255;
  }

  // Returns the slot index when the entry matches, otherwise -1.
  probe(hashLo, hashHi) {
    const index = hashLo & this.mask;
    if (this.flags[index] && this.keys[index] === hashHi) return index;
    return -1;
  }

  store(hashLo, hashHi, depth, flag, score, move) {
    const index = hashLo & this.mask;
    const existing = this.flags[index];
    // Replace when empty, from an older search, the same position, or shallower.
    if (existing && this.ages[index] === this.age && this.keys[index] !== hashHi &&
        this.depths[index] > depth) {
      return;
    }
    if (!existing) this.used++;
    // Keep the old best move when the new result has none for the same position.
    if (!move && this.keys[index] === hashHi) move = this.moves[index];
    this.keys[index] = hashHi;
    this.moves[index] = move;
    this.scores[index] = score;
    this.depths[index] = depth;
    this.flags[index] = flag;
    this.ages[index] = this.age;
  }

  // Permille of slots in use, as reported by UCI engines.
  hashfull() {
    return Math.round((this.used / this.size) * 1000);
  }
}
