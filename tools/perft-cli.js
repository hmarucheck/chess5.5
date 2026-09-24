// Command-line perft runner for checking the move generator.
//   npm run perft -- 5
//   npm run perft -- 4 "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1"
//   npm run perft -- 3 "<fen>" --divide

import { parseFen } from '../src/engine/fen.js';
import { perft, divide } from '../src/engine/perft.js';
import { START_FEN } from '../src/engine/constants.js';

const args = process.argv.slice(2);
const showDivide = args.includes('--divide');
const positional = args.filter((a) => a !== '--divide');
const depth = Number(positional[0] || 4);
const fen = positional[1] || START_FEN;

const pos = parseFen(fen);
console.log(pos.toString());
console.log(`\nFEN: ${fen}`);

if (showDivide) {
  const result = divide(pos, depth);
  let total = 0;
  for (const [move, count] of Object.entries(result).sort()) {
    console.log(`${move}: ${count}`);
    total += count;
  }
  console.log(`\nTotal: ${total}`);
} else {
  for (let d = 1; d <= depth; d++) {
    const start = performance.now();
    const nodes = perft(pos, d);
    const ms = performance.now() - start;
    const nps = ms > 0 ? Math.round((nodes / ms) * 1000).toLocaleString() : '-';
    console.log(`depth ${d}: ${nodes.toLocaleString().padStart(12)} nodes  ${ms.toFixed(0).padStart(6)} ms  ${nps} nps`);
  }
}
