// Web Worker entry point. Every request carries an id; replies echo it so the
// main thread can drop results for requests it no longer cares about.

import { Engine } from './engine.js';

const engine = new Engine({ hashMb: 32 });

function handle(data) {
  const { id, type } = data;
  const info = (payload) => self.postMessage({ id, type: 'info', payload });
  try {
    switch (type) {
      case 'play': {
        const result = engine.play(data.request, info);
        self.postMessage({ id, type: 'result', payload: result });
        break;
      }
      case 'analyze': {
        const result = engine.analyze(data.request, info);
        self.postMessage({ id, type: 'result', payload: result });
        break;
      }
      case 'review': {
        const results = engine.review(data.request, (index, analysis) => {
          self.postMessage({ id, type: 'progress', payload: { index, analysis } });
        });
        self.postMessage({ id, type: 'result', payload: results });
        break;
      }
      case 'newgame':
        engine.newGame();
        self.postMessage({ id, type: 'result', payload: true });
        break;
      case 'ping':
        self.postMessage({ id, type: 'result', payload: 'pong' });
        break;
      default:
        throw new Error(`Unknown request type "${type}".`);
    }
  } catch (err) {
    self.postMessage({ id, type: 'error', payload: err && err.message ? err.message : String(err) });
  }
}

self.onmessage = (event) => handle(event.data);
