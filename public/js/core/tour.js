/**
 * Guided tours: a step-by-step walk through the page that is showing, each
 * step spotlighting one part of it with a short explanation. A first-time
 * visitor is offered one once; "Take a tour of this page" in the footer
 * replays it any time.
 *
 * The spotlight itself is Driver.js (MIT), loaded from the jsDelivr CDN the
 * first time a tour starts and only run if it matches the hash below — the
 * same care as the other on-demand libraries (MP3 encoder, PDF export).
 *
 * Steps whose element isn't on the page right now (the taal circle before a
 * taal is chosen, the shortcuts hint on a phone) are left out.
 */
import { $ } from './dom.js';
import { currentView, onEnterView, onLeaveView } from './navigation.js';
import { toast } from './toast.js';

const DRIVER_JS = 'https://cdn.jsdelivr.net/npm/driver.js@1.8.0/dist/driver.js.iife.js';
const DRIVER_JS_HASH = 'sha384-ZD4UAn12lO2plEJ4lonOHO0fRSCgq0VAuoDx6/rglijDjzDYIXgCexIVu3PFJpJf';
const DRIVER_CSS = 'https://cdn.jsdelivr.net/npm/driver.js@1.8.0/dist/driver.css';
const DRIVER_CSS_HASH = 'sha384-XUGWln86d3kDvw/W1Qbii8QQyeWs2LcFYfGhYrmSZ0ZiXxowttKpfdhPdLE+WMFx';

const OFFERED_KEY = 'swaralaya_tour_offered';
const OFFER_DELAY_MS = 1800;

/** [selector, title, text] per step, for each view that has a tour. */
export const TOURS = {
  'view-home': [
    ['.site-nav', 'Four sections', 'Carnatic and Hindustani practice tools, the Stem Separator, and games. The logo on the left always brings you back to this page.'],
    ['#resumeCard', 'Pick up where you left off', 'Your last lehra setup and today’s practice against your daily goal. One tap reopens the player exactly as you left it.'],
    ['#view-home .dashboard-grid', 'Choose where to start', 'Hindustani has the Lehra Player and the Notation Editor; Carnatic has a shruti box and a talam keeper; Games train your ear and your laya.'],
    ['#tunerBtn', 'Swar tuner', 'Sing or play into the microphone to see which swar you are on and how many cents sharp or flat. It follows the Sa of the page you are on.'],
    ['#statsBtn', 'Riyaz tracker', 'Your practice time for the last seven days, your daily goal and your streak.'],
    ['#accountBtn', 'Your progress', 'All your practice and game scores in one place.'],
    ['.footer-nav', 'Every tool, one link away', 'Wherever you are on the site, these links jump straight to any tool.'],
  ],
  'view-hindustani': [
    ['#view-hindustani .dashboard-card:nth-child(1)', 'Lehra Player', 'A lehra on sarangi, harmonium, sitar or esraj to practise tabla or Kathak with — in any taal, tempo and Sa.'],
    ['#view-hindustani .dashboard-card:nth-child(2)', 'Notation Editor', 'Write tabla or vocal compositions in Bhatkhande or Paluskar notation, hear them played, and share or print them.'],
    ['#view-hindustani .dashboard-card:nth-child(3)', 'Practise Along', 'Separate any song into its parts, then play the accompaniment at your own Sa and speed.'],
  ],
  'view-lehra': [
    ['#nowPlayingCard', 'Now playing', 'The raag, instrument, taal and tempo you have chosen. While the lehra plays, the matra counter shows where you are in the cycle.'],
    ['.pitch-wrap', 'Your Sa', 'Pick your scale, or type an exact pitch in hertz. The lehra and the tanpura follow at once, without restarting.'],
    ['#taalCircle', 'The taal circle', 'One cycle of the taal: sam at the top, the vibhags marked X, 2, 0, 3, and the theka’s bols inside. A hand sweeps round it in time with the lehra.'],
    ['.raag-finder', 'Find a raag', 'Type a raag, taal or instrument — in any spelling — and pick it. Star a raag to keep it here; the ones you play are remembered too.'],
    ['.controls-grid', 'Or browse', 'Choose an instrument, then a taal, then a raag. You can switch raag while the lehra is playing.'],
    ['.tempo-panel', 'Tempo', 'Tap a preset, drag the slider, type a number or tap the tempo yourself. The Laya trainer raises the tempo for you every few cycles.'],
    ['.volume-row', 'The mix', 'Set the levels of the lehra, the tanpura and the metronome, and choose the tanpura’s sound.'],
    ['.transport', 'Play, stop, loop', 'Space also plays and pauses. With loop off, the lehra finishes its cycle and stops on sam.'],
    ['.options-row', 'Metronome and more', 'A click on every beat with sam, taali and khali accented, a count-in before the lehra enters, Studio effects, and presets to save a whole setup.'],
    ['#practiceTimer', 'Practice timer', 'Stop on sam after a set time or number of cycles.'],
    ['#recorderBox', 'Record your riyaz', 'Record yourself with the lehra, then see an intonation report of the take. Recordings stay on this device.'],
    ['#exportBox', 'Export audio', 'Save the lehra as an MP3 or WAV of any length, ending on sam.'],
    ['.beat-visualizer', 'Beats and theka', 'Each matra lights up as it sounds, with the theka written out underneath.'],
    ['#fullscreenBtn', 'Fullscreen', 'Just the raag, the matra and the taal circle — for when the screen is across the room.'],
    ['#shortcutsBtn', 'Keyboard shortcuts', 'Press ? at any time for the full list.'],
  ],
  'view-carnatic': [
    ['#shrutiPanel', 'Shruti box', 'A drone at your kattai — a plucked tanpura or a reed shruti box, with Pa, Ma or Ni alongside Sa. Fine-tune it in hertz if you need to.'],
    ['#talamPanel', 'Talam', 'Choose a tala, its kalai and nadai, and a tempo. Any suladi tala can be built from its family and jati.'],
    ['#talamAngas', 'Follow the kriyas', 'The angas of the tala. While it runs, the current beat is lit: clap, finger count or wave.'],
    ['#tunerBtn', 'Swar tuner', 'On this page the tuner measures against your shruti and uses the Carnatic swara names.'],
  ],
  'view-notation': [
    ['.studio-toggles', 'What you are writing', 'Tabla or vocal, Bhatkhande or Paluskar, in English or Hindi. The palette and the marks change to match.'],
    ['.studio-sidebar', 'Palette', 'Click a bol or swar to put it in the selected cell. Search to find one quickly.'],
    ['.notation-toolbar', 'Taal, templates and marks', 'Set the taal, start from a kaida, rela or tukda, and add the octave and komal / tivra marks.'],
    ['#nsGrid', 'The composition', 'Click a cell and type, or use the palette. Vibhags carry their X, 2, 0, 3 markers; “+ Add Line” adds another cycle.'],
    ['#nsPlayBtn', 'Hear it', 'Plays what you have written, at the Lehra player’s tempo.'],
    ['#nsLibraryBtn', 'Save and share', 'Keep compositions in this browser, export them as files, or copy a link that carries the whole composition.'],
    ['#nsExportBtn', 'PDF', 'A print-ready copy of the page.'],
    ['#nsHelpBtn', 'Guide', 'A short reference for the editor.'],
  ],
  'view-games': [
    ['#gamesHub [data-game="swar"]', 'Swar Pehchaan', 'A drone holds Sa and a swar is sung: name it. Three lives, and the raags get harder as you go.'],
    ['#gamesHub [data-game="sam"]', 'Sam Pakdo', 'The lehra plays and you tap exactly on sam. Earn stars to unlock the next stage.'],
    ['#accountBtn', 'Your scores', 'Best scores and stars are kept, and shown with your practice on the Your Progress page.'],
  ],
  'view-account': [
    ['#accountStats', 'Your numbers', 'Practice time and game scores. Time is counted whenever a lehra is playing.'],
    ['.account-links', 'Add to them', 'Practise with a lehra or play a game — both show up here.'],
    ['#accountBox', 'Keep it across devices', 'Signing in backs these up and keeps them in step between your phone and your computer. It is optional.'],
  ],
};

const isShowing = el => !!el && !el.hidden && el.getClientRects().length > 0;

/** The steps of `view`'s tour whose elements are on the page now. */
function stepsFor(view) {
  return (TOURS[view] || [])
    .map(([selector, title, description]) => ({ element: document.querySelector(selector), title, description }))
    .filter(step => isShowing(step.element))
    .map(step => ({ element: step.element, popover: { title: step.title, description: step.description } }));
}

// ── Driver.js, from the CDN ────────────────────────────────────────
let loading = null;

function loadDriver() {
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = DRIVER_CSS;
      css.integrity = DRIVER_CSS_HASH;
      css.crossOrigin = 'anonymous';
      const script = document.createElement('script');
      script.src = DRIVER_JS;
      script.integrity = DRIVER_JS_HASH;
      script.crossOrigin = 'anonymous';
      script.onload = () => {
        const create = window.driver && window.driver.js && window.driver.js.driver;
        if (create) resolve(create);
        else reject(new Error('the tour library did not start'));
      };
      script.onerror = () => {
        css.remove();
        script.remove();
        reject(new Error('the tour library could not be loaded'));
      };
      document.head.append(css, script);
    });
    loading.catch(() => { loading = null; }); // offline now: a later try may work
  }
  return loading;
}

let starting = false;
let activeTour = null;
// Driver.js marks the page while a tour is open — asked directly, because its
// "ended" callback is skipped when a tour is closed before its first step settles.
const tourOpen = () => document.body.classList.contains('driver-active');

/** Start the tour of `view` (the one showing by default). */
export async function startTour(view = currentView()) {
  if (starting || tourOpen()) return;
  if (!stepsFor(view).length) {
    toast('There is nothing to tour on this page right now.');
    return;
  }
  const btn = $('tourBtn');
  starting = true;
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Loading the tour…';
  }
  try {
    const createDriver = await loadDriver();
    const steps = stepsFor(view); // the page may have changed while the library loaded
    if (!steps.length || view !== currentView()) return;
    activeTour = createDriver({
      steps,
      showProgress: true,
      progressText: '{{current}} of {{total}}',
      nextBtnText: 'Next',
      prevBtnText: 'Back',
      doneBtnText: 'Done',
      popoverClass: 'swaralaya-tour',
      overlayColor: '#000',
      overlayOpacity: 0.72,
      stagePadding: 6,
      stageRadius: 12,
    });
    activeTour.drive();
  } catch (err) {
    console.warn('Tour:', err);
    toast(navigator.onLine === false
      ? 'The tour needs an internet connection the first time. Try again when you’re online.'
      : 'The tour couldn’t be loaded. Check your connection and try again.', { type: 'error' });
  } finally {
    starting = false;
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Take a tour of this page';
    }
  }
}

// ── First visit: offer it once ─────────────────────────────────────
function offerTour() {
  try {
    if (localStorage.getItem(OFFERED_KEY)) return;
  } catch {
    return; // no storage: it would be offered on every visit
  }
  const view = currentView();
  if (starting || tourOpen() || !stepsFor(view).length || document.body.classList.contains('modal-open')) return;
  try { localStorage.setItem(OFFERED_KEY, '1'); } catch { return; }

  const card = document.createElement('div');
  card.className = 'tour-offer';
  card.setAttribute('role', 'region');
  card.setAttribute('aria-label', 'Guided tour');
  const text = document.createElement('p');
  text.textContent = 'New here? A one-minute tour shows what everything on this page does.';
  const start = document.createElement('button');
  start.type = 'button';
  start.className = 'btn-tap';
  start.textContent = 'Show me';
  const skip = document.createElement('button');
  skip.type = 'button';
  skip.className = 'header-icon-btn';
  skip.textContent = 'Not now';
  const close = () => card.remove();
  start.addEventListener('click', () => {
    close();
    startTour();
  });
  skip.addEventListener('click', () => {
    close();
    toast('“Take a tour of this page” at the bottom of any page starts it whenever you like.', { duration: 5000 });
  });
  const actions = document.createElement('div');
  actions.className = 'tour-offer-actions';
  actions.append(start, skip);
  card.append(text, actions);
  document.body.appendChild(card);
}

export function initTour() {
  const btn = $('tourBtn');
  const update = view => { if (btn) btn.hidden = !TOURS[view]; };
  btn?.addEventListener('click', () => startTour());
  // A tour belongs to its page: Back or a link during one ends it
  onLeaveView(() => { if (tourOpen()) activeTour?.destroy(); });
  onEnterView(update);
  update(currentView());
  setTimeout(offerTour, OFFER_DELAY_MS);
}
