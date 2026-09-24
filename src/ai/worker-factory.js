// Creates the engine worker when the app runs as ES modules from a server.
// The single-file build replaces this module with one that starts the
// worker from an inlined Blob instead.

export function createEngineWorker() {
  return new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
}
