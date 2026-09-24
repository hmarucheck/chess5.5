// Small DOM helpers: element lookup, dialogs built on <dialog>, a
// confirmation prompt that works where window.confirm() is blocked, toasts,
// and clipboard/download helpers with fallbacks.

export function $(selector, root = document) {
  return root.querySelector(selector);
}

export function $$(selector, root = document) {
  return [...root.querySelectorAll(selector)];
}

export function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function openDialog(dialog) {
  if (!dialog) return;
  if (typeof dialog.showModal === 'function') {
    if (!dialog.open) dialog.showModal();
  } else {
    dialog.setAttribute('open', '');
  }
  const focusable = dialog.querySelector('[autofocus], .dialog-body button, .dialog-body input, .dialog-body select, .dialog-body textarea');
  if (focusable) setTimeout(() => focusable.focus(), 0);
}

export function closeDialog(dialog) {
  if (!dialog) return;
  if (typeof dialog.close === 'function' && dialog.open) dialog.close();
  else dialog.removeAttribute('open');
}

// Wires close buttons and backdrop clicks for every dialog on the page.
export function initDialogs() {
  for (const dialog of $$('dialog')) {
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) closeDialog(dialog);
    });
    for (const btn of $$('[data-close]', dialog)) {
      btn.addEventListener('click', () => closeDialog(dialog));
    }
  }
}

// In-page replacement for window.confirm(). Resolves true or false.
export function confirmAction({ title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false }) {
  const dialog = $('#confirm-dialog');
  $('#confirm-title', dialog).textContent = title;
  $('#confirm-message', dialog).textContent = message;
  const ok = $('#confirm-ok', dialog);
  const cancel = $('#confirm-cancel', dialog);
  ok.textContent = confirmLabel;
  cancel.textContent = cancelLabel;
  ok.classList.toggle('btn-danger', danger);
  ok.classList.toggle('btn-primary', !danger);
  return new Promise((resolve) => {
    const finish = (value) => {
      ok.removeEventListener('click', onOk);
      cancel.removeEventListener('click', onCancel);
      dialog.removeEventListener('close', onClose);
      closeDialog(dialog);
      resolve(value);
    };
    const onOk = () => finish(true);
    const onCancel = () => finish(false);
    const onClose = () => finish(false);
    ok.addEventListener('click', onOk);
    cancel.addEventListener('click', onCancel);
    dialog.addEventListener('close', onClose);
    openDialog(dialog);
    setTimeout(() => cancel.focus(), 0);
  });
}

let toastTimer = null;

export function toast(message, { tone = 'info', duration = 2600 } = {}) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = message;
  el.dataset.tone = tone;
  el.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('visible'), duration);
}

export async function copyText(text, fallbackField = null) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    if (fallbackField) {
      fallbackField.focus();
      fallbackField.select();
      try {
        return document.execCommand('copy');
      } catch {
        return false;
      }
    }
    return false;
  }
}

export function downloadText(filename, text, type = 'application/x-chess-pgn') {
  try {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  } catch {
    return false;
  }
}

export function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}
