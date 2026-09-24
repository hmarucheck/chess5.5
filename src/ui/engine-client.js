// Main-thread side of the engine. Requests go to a Web Worker so the page
// stays responsive while the engine thinks. If a worker cannot start (some
// browsers refuse module workers on file:// pages), the same Engine class
// runs on the main thread instead.
//
// A search can't be interrupted from outside, so cancel() terminates the
// worker and starts a fresh one; the transposition table is lost, which is
// cheap compared with waiting for a search nobody wants.

import { createEngineWorker } from '../ai/worker-factory.js';
import { Engine } from '../ai/engine.js';

export class EngineCancelled extends Error {
  constructor() {
    super('Engine request cancelled');
    this.name = 'EngineCancelled';
  }
}

export class EngineClient {
  constructor() {
    this.nextId = 1;
    this.pending = new Map();
    this.worker = null;
    this.fallback = null;
    this.mode = 'starting';
    this.onStatus = null;
    this.startWorker();
  }

  startWorker() {
    try {
      this.worker = createEngineWorker();
      this.worker.onmessage = (event) => this.onMessage(event.data);
      this.worker.onerror = (event) => {
        if (event && event.preventDefault) event.preventDefault();
        this.useFallback();
      };
      this.mode = 'worker';
    } catch {
      this.useFallback();
    }
  }

  // Switch to the in-page engine and re-run whatever was waiting.
  useFallback() {
    if (this.worker) {
      try { this.worker.terminate(); } catch { /* already gone */ }
    }
    this.worker = null;
    if (!this.fallback) this.fallback = new Engine({ hashMb: 16 });
    this.mode = 'main-thread';
    if (this.onStatus) this.onStatus(this.mode);
    const waiting = [...this.pending.values()];
    for (const job of waiting) this.runOnMainThread(job);
  }

  onMessage(message) {
    const job = this.pending.get(message.id);
    if (!job) return;
    switch (message.type) {
      case 'info':
        if (job.onInfo) job.onInfo(message.payload);
        break;
      case 'progress':
        if (job.onProgress) job.onProgress(message.payload);
        break;
      case 'result':
        this.pending.delete(message.id);
        job.resolve(message.payload);
        break;
      case 'error':
        this.pending.delete(message.id);
        job.reject(new Error(message.payload));
        break;
      default:
        break;
    }
  }

  runOnMainThread(job) {
    // Yield first so the UI can paint "thinking" before the search blocks it.
    setTimeout(() => {
      if (!this.pending.has(job.id)) return;
      try {
        let result;
        if (job.type === 'play') result = this.fallback.play(job.request, job.onInfo);
        else if (job.type === 'analyze') result = this.fallback.analyze(job.request, job.onInfo);
        else if (job.type === 'review') {
          result = this.fallback.review(job.request, (index, analysis) => job.onProgress && job.onProgress({ index, analysis }));
        } else if (job.type === 'newgame') {
          this.fallback.newGame();
          result = true;
        }
        if (!this.pending.has(job.id)) return;
        this.pending.delete(job.id);
        job.resolve(result);
      } catch (err) {
        this.pending.delete(job.id);
        job.reject(err);
      }
    }, 30);
  }

  // Sends a request; returns a promise for its result.
  request(type, request, { onInfo = null, onProgress = null } = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const job = { id, type, request, onInfo, onProgress, resolve, reject };
      this.pending.set(id, job);
      if (this.worker) {
        this.worker.postMessage({ id, type, request });
      } else {
        this.runOnMainThread(job);
      }
    });
  }

  play(request, onInfo) {
    return this.request('play', request, { onInfo });
  }

  analyze(request, onInfo) {
    return this.request('analyze', request, { onInfo });
  }

  review(request, onProgress) {
    return this.request('review', request, { onProgress });
  }

  get busy() {
    return this.pending.size > 0;
  }

  // Abandons every outstanding request.
  cancelAll() {
    if (!this.pending.size) return;
    const jobs = [...this.pending.values()];
    this.pending.clear();
    for (const job of jobs) job.reject(new EngineCancelled());
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
      this.startWorker();
    }
  }
}
