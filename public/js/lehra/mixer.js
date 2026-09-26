/** Volume sliders and the Studio FX panel (bass, treble, reverb). */
import { $ } from '../core/dom.js';
import { audio } from './audio.js';

// Each handler also runs once when the audio graph is built (audio.js
// re-dispatches 'input'), which applies settings made before first play.
function bindVolume(sliderId, labelId, gainKey, initial) {
  const slider = $(sliderId);
  slider.addEventListener('input', e => {
    const v = +e.target.value;
    const gain = audio[gainKey];
    if (gain) gain.gain.setTargetAtTime(v / 100, audio.ctx.currentTime, 0.02);
    $(labelId).textContent = v + '%';
    slider.style.setProperty('--val', v + '%');
  });
  slider.style.setProperty('--val', initial);
}

function bindShelf(sliderId, labelId, filterKey) {
  const slider = $(sliderId);
  if (!slider) return;
  slider.addEventListener('input', e => {
    const v = +e.target.value;
    const filter = audio[filterKey];
    if (filter) filter.gain.setTargetAtTime(v, audio.ctx.currentTime, 0.02);
    $(labelId).textContent = v + 'dB';
    slider.style.setProperty('--val', ((v + 12) / 24 * 100) + '%');
  });
  slider.style.setProperty('--val', '50%');
}

function bindReverb() {
  const slider = $('fxReverb');
  if (!slider) return;
  // The ConvolverNode is only wired while reverb > 0, so it costs no CPU at 0.
  let reverbActive = false;

  slider.addEventListener('input', e => {
    const v = +e.target.value;
    const wet = v / 100;
    const dry = 1 - (wet * 0.5);
    $('fxReverbVal').textContent = v + '%';
    slider.style.setProperty('--val', v + '%');
    if (!audio.filterTreble) return; // no graph yet: applied when it's built

    if (wet > 0 && !reverbActive) {
      try { audio.filterTreble.connect(audio.reverbNode); } catch { /* already connected */ }
      try { audio.reverbNode.connect(audio.wetGain); } catch { /* already connected */ }
      reverbActive = true;
    } else if (wet === 0 && reverbActive) {
      try { audio.filterTreble.disconnect(audio.reverbNode); } catch { /* not connected */ }
      try { audio.reverbNode.disconnect(audio.wetGain); } catch { /* not connected */ }
      reverbActive = false;
    }
    audio.wetGain.gain.setTargetAtTime(wet, audio.ctx.currentTime, 0.02);
    audio.dryGain.gain.setTargetAtTime(dry, audio.ctx.currentTime, 0.02);
  });
  slider.style.setProperty('--val', '0%');
}

export function initMixer() {
  bindVolume('lehraVol', 'lehraVolVal', 'gainLehra', '80%');
  bindVolume('tanpuraVol', 'tanpuraVolVal', 'gainTanpura', '50%');
  bindVolume('metronomeVol', 'metronomeVolVal', 'gainMetronome', '60%');
  bindShelf('fxBass', 'fxBassVal', 'filterBass');
  bindShelf('fxTreble', 'fxTrebleVal', 'filterTreble');
  bindReverb();
}
