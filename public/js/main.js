/**
 * Swaralaya — entry point (loaded as an ES module by index.html).
 *
 *   core/       shared helpers: DOM, the one AudioContext and its output,
 *               media session, microphone, view routing and page metadata,
 *               modals, toasts, app install
 *   lehra/      Lehra player (real-time engine, controls, metronome, riyaz)
 *   notation/   Notation Editor
 *   carnatic/   Carnatic suite (shruti box, talam metronome)
 *   practice/   practise along with a separated song (Lehra engine, song mode)
 *   games/      riyaz games: Swar Pehchaan (ear), Sam Pakdo (laya)
 *   tuner/      swar tuner (microphone pitch detection)
 *   account/    Your Progress page; optional Google sign-in to sync practice and scores
 *   audiolab/   Audio Lab: clean up, mix and master a tabla / lehra recording (server-side, audio_lab/);
 *               loaded the first time its page shows (see loadAudioLab below)
 */
import { initAccount } from './account/index.js';
import { carnaticSa, initCarnatic, stopAll as stopCarnatic } from './carnatic/index.js';
import { initModals } from './core/modals.js';
import { currentView, initNavigation, onEnterView, onLeaveView } from './core/navigation.js';
import { initPwa } from './core/pwa.js';
import { toast } from './core/toast.js';
import { initTour } from './core/tour.js';
import { initGames, leaveGames } from './games/index.js';
import { initLehra, leaveLehra } from './lehra/index.js';
import { renderResumeCard } from './lehra/resume.js';
import { openSharedSetup } from './lehra/settings.js';
import { state as lehraState } from './lehra/state.js';
import { initNotationStudio, openSharedComposition, stopNotationPlayback } from './notation/notation.js';
import { initPractice, leavePractice, openPracticeFromUrl, practiceSa } from './practice/index.js';
import { initTuner, registerTunerReference } from './tuner/tuner.js';

initLehra();
initNotationStudio();
initCarnatic();
initPractice();
initGames();

// The Audio Lab is about a quarter of the site's script and only its own page
// uses it, so the other pages never download it. (Its own page preloads it;
// see tools/build-static.mjs.)
let audioLab = null;
function loadAudioLab() {
  audioLab ||= import('./audiolab/index.js')
    .then(lab => { lab.initAudioLab(); return lab; })
    .catch(err => {
      audioLab = null;                     // try again next time the page is opened
      toast('The Audio Lab could not load. Check your connection and open it again.');
      throw err;
    });
  return audioLab;
}
onEnterView(view => {
  if (view !== 'view-audio') return;
  loadAudioLab().then(lab => { if (currentView() === 'view-audio') lab.enterAudioLab(); }, () => {});
});

// The tuner measures against the Lehra's Sa on the Hindustani pages.
const lehraSa = () => ({ sa: lehraState.pitchHz, system: 'hindustani' });
['view-home', 'view-hindustani', 'view-lehra', 'view-notation', 'view-games'].forEach(v => registerTunerReference(v, lehraSa));
registerTunerReference('view-carnatic', () => ({ sa: carnaticSa(), system: 'carnatic' }));
registerTunerReference('view-practice', () => ({ sa: practiceSa(), system: 'hindustani' }));
initTuner();
initModals();
initPwa();
initAccount();

// The home page's "continue your riyaz" card: the lehra setup and today's practice
renderResumeCard();
onEnterView(view => { if (view === 'view-home') renderResumeCard(); });

// Nothing keeps playing on a page you've left.
onLeaveView(leaveLehra);
onLeaveView(stopNotationPlayback);
onLeaveView(stopCarnatic);
onLeaveView(leavePractice);
onLeaveView(leaveGames);
onLeaveView(() => { if (audioLab) audioLab.then(lab => lab.leaveAudioLab(), () => {}); });

initNavigation();
initTour();              // "Take a tour of this page", offered once to a first-time visitor
openSharedComposition(); // a composition link (#n=…) opens in the Notation Editor
openSharedSetup();       // a Lehra setup link (#s=…) opens in the Lehra player
// …also when one is opened in a tab that's already on the site (only the #hash changes)
window.addEventListener('hashchange', () => {
  openSharedComposition();
  openSharedSetup();
});
openPracticeFromUrl();   // /practice?job=… : a separated song to practise along with
