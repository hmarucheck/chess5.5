// Entry point: boots the app once the DOM is ready.

import { App } from './ui/app.js';

function boot() {
  const app = new App();
  app.init();
  // Exposed for debugging from the browser console.
  window.chessApp = app;
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
