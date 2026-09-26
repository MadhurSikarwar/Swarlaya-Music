/**
 * Swaralaya — entry point (loaded as an ES module by index.html).
 *
 *   core/       shared helpers: DOM, the one AudioContext, view routing
 *   lehra/      Lehra player (real-time engine, controls, metronome, riyaz)
 *   notation/   Notation Editor
 */
import { initNavigation, onLeaveView } from './core/navigation.js';
import { initLehra, leaveLehra } from './lehra/index.js';
import { state as lehraState } from './lehra/state.js';
import { initNotationStudio, openSharedComposition, stopNotationPlayback } from './notation/notation.js';
import { initTuner, registerTunerReference } from './tuner/tuner.js';

initLehra();
initNotationStudio();

// The tuner measures against the Lehra's Sa on the Hindustani pages.
const lehraSa = () => ({ sa: lehraState.pitchHz, system: 'hindustani' });
['view-home', 'view-hindustani', 'view-lehra', 'view-notation'].forEach(v => registerTunerReference(v, lehraSa));
initTuner();

// Nothing keeps playing on a page you've left.
onLeaveView(leaveLehra);
onLeaveView(stopNotationPlayback);

initNavigation();
openSharedComposition(); // a composition link (#n=…) opens in the Notation Editor
