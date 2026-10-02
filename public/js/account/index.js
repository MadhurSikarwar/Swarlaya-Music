/**
 * Your Progress (/account): the riyaz log and game scores in one place —
 * and, where sign-in is set up (config.js), "Continue with Google" to keep
 * them backed up and in step across devices.
 *
 *   sync.js      what is stored and how a device and the cloud are merged
 *   firebase.js  the backend (Google sign-in + one Firestore document)
 *
 * Signing in is optional: without it everything stays on the device as
 * before. Once signed in, the device syncs when it starts, a few seconds
 * after practice is logged or a game score improves, and when the tab comes
 * back into view — pulling what the other devices added and pushing its own.
 */
import { $ } from '../core/dom.js';
import { onEnterView } from '../core/navigation.js';
import { toast } from '../core/toast.js';
import { SAM_STAGES } from '../games/rules.js';
import { loadProgress, saveProgress } from '../games/store.js';
import { formatPractice, riyazGoal, riyazLog, riyazSummary, setRiyazGoal, setRiyazOthers } from '../lehra/riyaz.js';
import { on } from '../lehra/state.js';
import { FIREBASE_CONFIG } from './config.js';
import { mergeAccount, newDeviceId } from './sync.js';

const DEVICE_KEY = 'swaralaya_device_id';
const SIGNED_IN_KEY = 'swaralaya_signed_in';   // "this browser has an account": load the SDK at start
const SYNC_DELAY_MS = 3000;
const RESYNC_AFTER_MS = 60000;

let backendFactory = FIREBASE_CONFIG
  ? () => import('./firebase.js').then(m => m.createFirebaseBackend(FIREBASE_CONFIG))
  : null;
let backend = null;          // set once loaded
let connecting = null;       // Promise while the backend loads
let user = null;
let phase = 'idle';          // 'idle' | 'loading' | 'signedOut' | 'signingIn' | 'signedIn'
let syncing = false;
let syncAgain = false;
let syncTimer = null;
let lastSynced = 0;
let syncError = '';
let applyingCloud = false;

const stored = key => { try { return localStorage.getItem(key); } catch { return null; } };
const store = (key, value) => {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch { /* storage unavailable */ }
};

function deviceId() {
  let id = stored(DEVICE_KEY);
  if (!id) {
    id = newDeviceId();
    store(DEVICE_KEY, id);
  }
  return id;
}

/** What went wrong, in words a person can act on (null = nothing worth saying). */
function explain(err) {
  const code = err && err.code ? String(err.code) : '';
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request' || code === 'auth/user-cancelled') return null;
  if (code === 'auth/popup-blocked') return 'Your browser blocked the sign-in window. Allow pop-ups for this site and try again.';
  if (code === 'auth/network-request-failed' || navigator.onLine === false) return 'No internet connection. Try again when you’re back online.';
  // A request that never got an answer (fetch throws a TypeError; Firestore says "unavailable")
  if (err instanceof TypeError || /unavailable|network|failed to fetch/i.test(`${code} ${err && err.message}`)) return 'The server couldn’t be reached.';
  if (code === 'auth/unauthorized-domain') return 'This address isn’t allowed to sign in yet: add it under Authentication → Settings → Authorized domains in the Firebase console.';
  if (code === 'auth/operation-not-allowed') return 'Google sign-in isn’t switched on for this site yet (Firebase console → Authentication → Sign-in method).';
  if (code.includes('permission-denied')) return 'The database refused the request — the Firestore rules need to let each user read and write their own document (see firestore.rules).';
  return `Something went wrong (${(err && err.message) || 'unknown error'}).`;
}

// ── Rendering ──────────────────────────────────────────────────────
function renderStats() {
  if (!$('accountStats')) return;
  const riyaz = riyazSummary();
  const games = loadProgress();
  const stars = SAM_STAGES.reduce((n, s) => n + (games.samStars[s.id] || 0), 0);
  $('acToday').textContent = formatPractice(riyaz.today);
  $('acWeek').textContent = formatPractice(riyaz.week);
  $('acTotal').textContent = formatPractice(riyaz.total);
  $('acStreak').textContent = riyaz.streak ? `${riyaz.streak} day${riyaz.streak === 1 ? '' : 's'}` : '—';
  $('acSwar').textContent = games.swarBest || '—';
  $('acSam').textContent = `${stars} / ${SAM_STAGES.length * 3}`;
  $('acDays').textContent = riyaz.days
    ? `Practised on ${riyaz.days} day${riyaz.days === 1 ? '' : 's'} so far.`
    : 'Nothing logged yet — time is counted whenever a lehra is playing.';
}

function syncText() {
  if (syncing) return 'Syncing…';
  if (syncError) return `Couldn’t sync. ${syncError} It will try again.`;
  if (!lastSynced) return '';
  const mins = Math.round((Date.now() - lastSynced) / 60000);
  return mins < 1 ? 'Up to date — synced just now.' : `Up to date — synced ${mins} min ago.`;
}

function render() {
  const box = $('accountBox');
  if (!box) return;
  box.hidden = !backendFactory;
  const btn = $('accountBtn');
  if (btn) {
    btn.classList.toggle('active', !!user);
    btn.title = user ? `Your progress — signed in as ${user.name || user.email}` : 'Your progress';
  }
  if (!backendFactory) return;

  $('accountLoading').hidden = phase !== 'loading';
  $('accountSignedOut').hidden = !(phase === 'idle' || phase === 'signedOut' || phase === 'signingIn');
  $('accountSignedIn').hidden = phase !== 'signedIn';
  const signIn = $('accountSignIn');
  signIn.disabled = phase === 'signingIn';
  $('accountSignInLabel').textContent = phase === 'signingIn' ? 'Opening Google…' : 'Continue with Google';

  if (phase === 'signedIn' && user) {
    $('accountName').textContent = user.name || 'Signed in';
    $('accountEmail').textContent = user.email;
    const photo = $('accountPhoto'), initial = $('accountInitial');
    initial.textContent = (user.name || user.email || '?').trim().charAt(0).toUpperCase();
    if (user.photo && photo.dataset.src !== user.photo) {
      photo.dataset.src = user.photo;
      photo.src = user.photo;
    }
    const showPhoto = !!user.photo && !photo.dataset.failed;
    photo.hidden = !showPhoto;
    initial.hidden = showPhoto;
    $('accountSync').textContent = syncText();
    $('accountSyncNow').disabled = syncing;
  }
}

function showError(message) {
  const el = $('accountError');
  if (!el) return;
  el.hidden = !message;
  el.textContent = message || '';
}

// ── Sync ───────────────────────────────────────────────────────────
async function sync({ announce = false } = {}) {
  if (!user || !backend) return;
  if (syncing) { syncAgain = true; return; }
  clearTimeout(syncTimer);
  syncing = true;
  render();
  const uid = user.uid;
  try {
    const cloud = await backend.load(uid);
    const merged = mergeAccount({ riyaz: riyazLog(), goal: riyazGoal(), games: loadProgress() }, cloud, deviceId());
    if (!user || user.uid !== uid) return; // signed out (or switched) meanwhile
    setRiyazOthers(merged.others);
    if (merged.goalChanged) setRiyazGoal(merged.goal.min, merged.goal.at);
    if (merged.gamesChanged) {
      saveProgress(merged.games);
      applyingCloud = true; // the games hub refreshes its labels; this isn't a new score to sync
      document.dispatchEvent(new CustomEvent('games-progress'));
      applyingCloud = false;
    }
    if (merged.patch) await backend.save(uid, merged.patch);
    lastSynced = Date.now();
    syncError = '';
    if (announce) toast('Your progress is synced.', { type: 'success' });
  } catch (err) {
    console.warn('Account sync failed:', err);
    syncError = explain(err) || 'The server couldn’t be reached.';
    if (announce) toast(`Couldn’t sync. ${syncError}`, { type: 'error' });
  } finally {
    syncing = false;
    renderStats();
    render();
    if (syncAgain) {
      syncAgain = false;
      scheduleSync();
    }
  }
}

function scheduleSync() {
  if (!user || applyingCloud) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(sync, SYNC_DELAY_MS);
}

// ── Sign-in state ──────────────────────────────────────────────────
function onUser(next) {
  const wasSignedIn = !!user;
  user = next;
  // (the first report, "nobody yet", can arrive while the Google window is still open)
  phase = user ? 'signedIn' : phase === 'signingIn' ? 'signingIn' : 'signedOut';
  store(SIGNED_IN_KEY, user ? '1' : null);
  if (user) {
    showError('');
    sync();
  } else if (wasSignedIn) {
    // Signed out here: what the other devices logged goes with the account
    clearTimeout(syncTimer);
    setRiyazOthers({});
    lastSynced = 0;
    syncError = '';
    renderStats();
  }
  render();
}

/** Load the backend (once) and start following the sign-in state. */
function connect() {
  if (!backendFactory) return Promise.resolve(null);
  if (!connecting) {
    if (phase === 'idle') phase = 'loading';
    render();
    connecting = backendFactory().then(b => {
      backend = b;
      b.onUser(onUser);
      return b;
    });
    connecting.catch(err => {
      connecting = null;
      phase = 'signedOut';
      console.warn('Account service failed to load:', err);
      render();
    });
  }
  return connecting;
}

async function signIn() {
  showError('');
  phase = 'signingIn';
  render();
  try {
    const b = await connect();
    await b.signIn(); // onUser() takes it from here
  } catch (err) {
    showError(explain(err));
  } finally {
    if (!user) phase = 'signedOut';
    render();
  }
}

async function signOut() {
  if (!backend) return;
  try {
    await backend.signOut();
    toast('Signed out. Your progress stays on this device.');
  } catch (err) {
    showError(explain(err));
  }
}

async function deleteCloudData() {
  if (!backend || !user) return;
  if (!confirm('Delete your synced practice and scores from the cloud and sign out?\n\nWhat is saved on this device stays.')) return;
  try {
    await backend.remove(user.uid);
    await backend.signOut();
    toast('Your synced data was deleted.', { type: 'success' });
  } catch (err) {
    showError(explain(err));
  }
}

/** For tests and local checks: use `b` instead of Firebase (null = no accounts). */
export function setAccountBackend(b) {
  backendFactory = b ? () => Promise.resolve(b) : null;
  backend = null;
  connecting = null;
  user = null;
  phase = 'idle';
  render();
}

export function initAccount() {
  if (!$('view-account')) return;
  $('accountSignIn')?.addEventListener('click', signIn);
  $('accountSignOut')?.addEventListener('click', signOut);
  $('accountSyncNow')?.addEventListener('click', () => sync({ announce: true }));
  $('accountDelete')?.addEventListener('click', deleteCloudData);
  $('accountPhoto')?.addEventListener('error', e => {
    e.target.dataset.failed = '1';
    render();
  });

  // What changes the data: practice logged, the goal, a better game score
  on('riyaz', scheduleSync);
  document.addEventListener('games-progress', scheduleSync);
  // …and coming back to the tab or the network: another device may have added to it
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && user && Date.now() - lastSynced > RESYNC_AFTER_MS) scheduleSync();
  });
  window.addEventListener('online', scheduleSync);

  onEnterView(view => {
    if (view !== 'view-account') return;
    renderStats();
    connect();
  });
  renderStats();
  render();
  if ($('view-account').classList.contains('active-view')) connect();
  // A browser that has signed in before syncs wherever the visit starts
  else if (backendFactory && stored(SIGNED_IN_KEY)) setTimeout(connect, 1500);
}
