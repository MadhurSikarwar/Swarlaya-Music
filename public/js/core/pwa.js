/**
 * The site as an installed app: an "Install app" button (in the footer) on
 * browsers that offer installation, and a word when the connection drops —
 * the service worker (sw.js) keeps the tools and the lehras already played
 * working offline, so it is worth saying that they still do.
 */
import { $ } from './dom.js';
import { toast } from './toast.js';

export function initPwa() {
  const btn = $('installBtn');
  let installPrompt = null;

  // Fired when the browser would allow installing: keep the event to prompt from our own button
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    installPrompt = e;
    if (btn) btn.hidden = false;
  });
  btn?.addEventListener('click', async () => {
    if (!installPrompt) return;
    const prompt = installPrompt;
    installPrompt = null; // a prompt can be shown once
    btn.hidden = true;
    try {
      await prompt.prompt();
    } catch { /* dismissed, or no longer available */ }
  });
  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    if (btn) btn.hidden = true;
    toast('Swaralaya is installed — it now opens like an app.', { type: 'success' });
  });

  window.addEventListener('offline', () => {
    toast('You’re offline. The tools still work, with the lehras you’ve already played.', { duration: 6000 });
  });
  window.addEventListener('online', () => toast('Back online.', { type: 'success' }));
}
