# Chess 5.5

A complete chess game that runs in the browser: a full rules engine, a
computer opponent with ten strength levels, clocks, hints, live analysis,
post-game review with accuracy scores, and PGN/FEN import and export.
It has no dependencies and no build step to play.

## Play

**Easiest:** open `dist/chess.html` in any modern browser. It is a single
self-contained file (the engine runs in a Web Worker started from an inline
Blob), so it works straight from disk.

**From source:**

```sh
npm start          # serves the repo at http://localhost:8055
```

ES modules and module workers need `http://`, which is why the source version
needs the tiny bundled server (`tools/serve.js`, no packages required).

## Features

**Playing**
- Human vs computer, two players on one board, computer vs computer, and a
  free analysis board.
- Drag and drop or click-to-move, with legal-move dots, last-move and check
  highlights, and smooth animations between any two positions.
- Type moves in SAN or long algebraic (`Nf3`, `O-O`, `exd5`, `e7e8q`, `Ng1-f3`).
- Promotion picker (or always-queen), right-click arrows and square marks.
- Clocks from 1+0 bullet to 30+20 classical, or custom, with Fischer increment
  and the correct "timeout vs insufficient material" draw.
- Takebacks, hints, draw offers (the computer judges its own position), resign.
- Every automatic draw: stalemate, insufficient material, threefold
  repetition and the fifty-move rule.
- The game in progress, your settings and your record against each level are
  saved in the browser.

**Studying**
- Live engine analysis with evaluation bar, depth, speed and the principal
  variation in SAN, plus a breakdown of the static evaluation.
- Game review: the engine replays every position, labels moves as Book,
  Best, Excellent, Good, Inaccuracy, Mistake or Blunder, computes each side's
  accuracy, draws an evaluation graph and lists the key moments with better
  alternatives.
- Opening names with ECO codes for about 130 common lines.
- PGN import (comments, variations, NAGs and `[%clk]` tags are handled) and
  export (with review annotations and `[%eval]` tags); FEN load and copy.
  Pasting a PGN or FEN anywhere on the page loads it.

**Presentation**
- Six board themes, two piece sets (drawn "Atelier" pieces and Unicode glyphs),
  light and dark mode, synthesised sound effects, keyboard shortcuts, and a
  layout that works down to phone width.

## The engine

`src/engine` is the rules layer and `src/ai` is the computer player.

- **Board:** 0x88 mailbox with incremental Zobrist hashing (two 32-bit halves,
  since JavaScript lacks fast 64-bit integers) and an undo stack instead of
  board copies.
- **Move generation:** pseudo-legal generation with legality checked on make;
  verified against the standard perft suites.
- **Search:** iterative deepening PVS with aspiration windows, a
  transposition table, null-move pruning, late move reductions, reverse
  futility, futility and late-move pruning, internal iterative reduction,
  check extensions, mate-distance pruning, killer and history heuristics,
  SEE-based capture ordering and a quiescence search with delta pruning.
- **Evaluation:** tapered PeSTO piece-square tables plus pawn structure
  (passed, isolated, doubled, backward, connected), mobility, rook files,
  king shelter, bishop pair, a mop-up term for converting won endgames, and
  scaling for drawish material. It is exactly colour-symmetric (tested).
- **Strength levels:** levels 1 to 5 score every move shallowly and pick with
  Gaussian noise, which produces believable human mistakes; levels 6 to 10 run
  the full search with growing time budgets. An opening book adds variety.

It searches roughly 250k nodes per second in a browser and reaches depth 12
to 14 in a second or two from the opening.

## Development

```sh
npm test           # 80+ tests: perft, rules, notation, PGN, engine, review, clock
npm run build      # regenerates dist/chess.html (and dist/artifact.html)
npm run perft -- 5                     # perft from the start position
npm run perft -- 3 "<fen>" --divide    # per-move breakdown
```

The bundler (`tools/build.js`) is about 140 lines with no dependencies. To
keep it that simple the source follows two rules, which the build enforces:
imports are named imports from relative paths, and top-level names are unique
across modules.

```
index.html, styles.css      page and styles
src/main.js                 entry point
src/engine/                 constants, zobrist, position, fen, san, game, pgn, openings, perft
src/ai/                     evaluate, tt, search, book, engine, worker, worker-factory
src/ui/                     app (controller), board-view, pieces, clock, sound,
                            review, engine-client, storage, dom
test/                       node:test suites
tools/                      serve, build, perft-cli
```

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| ← → | Step through moves |
| Home / End | First / latest move |
| F | Flip board |
| N | New game |
| U | Take back |
| H | Hint |
| A | Toggle live analysis |
| / | Focus the move box |
