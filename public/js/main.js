/**
 * Swaralaya — entry point (loaded as an ES module by index.html).
 *
 *   core/       shared helpers: DOM, the one AudioContext and its output,
 *               media session, microphone, view routing
 *   lehra/      Lehra player (real-time engine, controls, metronome, riyaz)
 *   notation/   Notation Editor
 *   carnatic/   Carnatic suite (shruti box, talam metronome)
 *   practice/   practise along with a separated song (Lehra engine, song mode)
 *   tuner/      swar tuner (microphone pitch detection)
 */
import { carnaticSa, initCarnatic, stopAll as stopCarnatic } from './carnatic/index.js';
import { initNavigation, onLeaveView } from './core/navigation.js';
import { initLehra, leaveLehra } from './lehra/index.js';
import { state as lehraState } from './lehra/state.js';
import { initNotationStudio, openSharedComposition, stopNotationPlayback } from './notation/notation.js';
import { initPractice, leavePractice, openPracticeFromUrl, practiceSa } from './practice/index.js';
import { initTuner, registerTunerReference } from './tuner/tuner.js';

initLehra();
initNotationStudio();
initCarnatic();
initPractice();

// The tuner measures against the Lehra's Sa on the Hindustani pages.
const lehraSa = () => ({ sa: lehraState.pitchHz, system: 'hindustani' });
['view-home', 'view-hindustani', 'view-lehra', 'view-notation'].forEach(v => registerTunerReference(v, lehraSa));
registerTunerReference('view-carnatic', () => ({ sa: carnaticSa(), system: 'carnatic' }));
registerTunerReference('view-practice', () => ({ sa: practiceSa(), system: 'hindustani' }));
initTuner();

// Nothing keeps playing on a page you've left.
onLeaveView(leaveLehra);
onLeaveView(stopNotationPlayback);
onLeaveView(stopCarnatic);
onLeaveView(leavePractice);

initNavigation();
openSharedComposition(); // a composition link (#n=…) opens in the Notation Editor
openPracticeFromUrl();   // /practice?job=… : a separated song to practise along with
