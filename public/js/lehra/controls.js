/** Pitch, tempo, transport, keyboard, options, modals and fullscreen controls. */
import { $ } from '../core/dom.js';
import { setMediaOutputEnabled, startMediaOutput } from '../core/audio-output.js';
import { applyPitchChange, applyTempoChange, setLooping, stopPlayback, togglePlay } from './player.js';
import { renderStats } from './riyaz.js';
import { bpmToProgress, changeTempo, progressToBpm, setBpm, syncSlider } from './selection.js';
import { FINE_TUNE_MAX_HZ, FINE_TUNE_MIN_HZ, state } from './state.js';
import { setStatus } from './ui.js';
import { updateNowPlaying } from './visuals.js';
import { releaseWakeLock, requestWakeLock } from './wakelock.js';

function pitchLabel(sel) {
  return sel.options[sel.selectedIndex].text.replace(' (Original)', '').replace('(Original)', '');
}

function initPitchControls() {
  const sel = $('pitchSelect');
  $('tagPitch').textContent = pitchLabel(sel);
  $('tagPitch').classList.add('active');

  sel.addEventListener('change', () => {
    const newHz = parseFloat(sel.value);
    if (newHz === state.pitchHz) return;
    state.pitchHz = newHz;
    $('fineTuneHz').value = newHz.toFixed(2); // sync fine tune input
    $('tagPitch').textContent = pitchLabel(sel);
    $('tagPitch').classList.toggle('active', true);
    applyPitchChange();
  });

  const setCustomPitch = val => {
    state.pitchHz = val;
    $('tagPitch').textContent = 'Custom ' + val.toFixed(1) + 'Hz';
    $('tagPitch').classList.toggle('active', true);
    applyPitchChange();
  };

  // Live while typing, but only for in-range values (so typing "150" doesn't
  // jump the pitch to "1" on the way).
  $('fineTuneHz').addEventListener('input', e => {
    const val = parseFloat(e.target.value);
    if (isNaN(val) || val < FINE_TUNE_MIN_HZ || val > FINE_TUNE_MAX_HZ) return;
    setCustomPitch(val);
  });

  // On commit (Enter / blur), clamp out-of-range entries and show the result.
  $('fineTuneHz').addEventListener('change', e => {
    let val = parseFloat(e.target.value);
    if (isNaN(val)) val = state.pitchHz;
    val = Math.min(FINE_TUNE_MAX_HZ, Math.max(FINE_TUNE_MIN_HZ, val));
    e.target.value = val.toFixed(2);
    if (val !== state.pitchHz) setCustomPitch(val);
  });
}

function addLongPress(id, fn) {
  let iv = null;
  const el = $(id);
  const go = () => { fn(); iv = setInterval(fn, 80); };
  const stop = () => { clearInterval(iv); iv = null; };
  el.addEventListener('mousedown', go);
  el.addEventListener('mouseup', stop);
  el.addEventListener('mouseleave', stop);
  el.addEventListener('touchstart', e => { e.preventDefault(); go(); }, { passive: false });
  el.addEventListener('touchend', stop);
}

function initTempoControls() {
  $('tempoSlider').addEventListener('input', e => {
    if (!state.taalData) return;
    setBpm(progressToBpm(+e.target.value));
    syncSlider();
    applyTempoChange();
  });

  // ± buttons: a press nudges by 1; holding repeats every 80 ms
  addLongPress('bpmMinus', () => changeTempo(state.bpm - 1));
  addLongPress('bpmPlus', () => changeTempo(state.bpm + 1));

  // Tap tempo: average of the last few intervals
  $('tapTempoBtn').addEventListener('click', () => {
    if (!state.taalData) return;
    const now = Date.now();
    const last = state.tapTimes[state.tapTimes.length - 1];
    if (!last || now - last > 2000) {
      state.tapTimes = [now];
      setStatus('Tap again to set tempo…', '');
      return;
    }
    if (now - last < 100) return;
    state.tapTimes.push(now);
    if (state.tapTimes.length > 6) state.tapTimes.shift();
    if (state.tapTimes.length >= 2) {
      let total = 0;
      for (let i = 1; i < state.tapTimes.length; i++) total += state.tapTimes[i] - state.tapTimes[i - 1];
      changeTempo(Math.round(60000 / (total / (state.tapTimes.length - 1))));
      setStatus(`Tap tempo: ${state.bpm} BPM`, '');
    }
  });

  // Typed tempo: Enter / blur commits; Up/Down nudge ±1; typing previews on the slider.
  const tempoInput = $('tempoValue');
  const commitTypedBpm = () => {
    if (!state.taalData) return;
    const val = parseInt(tempoInput.value, 10);
    if (isNaN(val)) { syncSlider(); return; } // revert to last known BPM
    changeTempo(val);
  };
  tempoInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitTypedBpm();
      tempoInput.blur();
    }
    // Handle ±1 here and keep the global shortcut handler from applying it twice.
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.stopPropagation();
      changeTempo(state.bpm + (e.key === 'ArrowUp' ? 1 : -1));
    }
  });
  tempoInput.addEventListener('blur', commitTypedBpm);
  tempoInput.addEventListener('input', () => {
    const val = parseInt(tempoInput.value, 10);
    if (isNaN(val) || !state.taalData) return;
    const { minTempo, maxTempo } = state.taalData;
    if (val < minTempo || val > maxTempo) return;
    state.bpm = val;
    // Update the slider only; the tempo is applied on commit
    const progress = bpmToProgress(state.bpm);
    $('tempoSlider').value = progress;
    $('tempoSlider').style.setProperty('--slider-pct', (progress / 210 * 100).toFixed(1) + '%');
    updateNowPlaying();
  });
}

/** Loop on/off, with the loop button showing it. */
export function setLoop(on) {
  setLooping(on);
  $('loopBtn').classList.toggle('active', state.isLooping);
}

function initTransport() {
  $('playBtn').addEventListener('click', togglePlay);
  $('stopBtn').addEventListener('click', stopPlayback);
  $('loopBtn').classList.add('active');
  $('loopBtn').addEventListener('click', () => setLoop(!state.isLooping));

  document.addEventListener('keydown', e => {
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    // Space / arrows control the lehra only while its page is showing (and no dialog is open).
    if (!$('view-lehra')?.classList.contains('active-view') || document.body.classList.contains('modal-open')) return;

    // Space on a focused button, link or summary presses that control instead.
    if (e.code === 'Space' && (tag === 'BUTTON' || tag === 'A' || tag === 'SUMMARY')) return;
    if (e.code === 'Space') {
      e.preventDefault();
      togglePlay();
    } else if (e.code === 'ArrowUp' || e.code === 'ArrowDown') {
      e.preventDefault();
      changeTempo(state.bpm + (e.code === 'ArrowUp' ? 1 : -1));
    }
  });
}

function initOptions() {
  $('metronomeToggle').addEventListener('change', e => { state.metronomeEnabled = e.target.checked; });
  $('metronomeSoundSelect').addEventListener('change', e => { state.metronomeSound = e.target.value; });
  $('metronomeSubdivisionSelect')?.addEventListener('change', e => {
    state.metronomeSubdivision = parseInt(e.target.value, 10) || 1;
  });
  // Khali/Taali accents
  $('metronomeAccentsToggle')?.addEventListener('change', e => { state.metronomeAccents = e.target.checked; });
  $('countInToggle')?.addEventListener('change', e => { state.countInEnabled = e.target.checked; });
  $('wakeLockToggle').addEventListener('change', e => {
    state.wakeLockEnabled = e.target.checked;
    if (!state.wakeLockEnabled) releaseWakeLock();
    else if (state.isPlaying) requestWakeLock();
  });
  // Lock-screen controls / background playback (routes output via a media element)
  $('mediaOutputToggle')?.addEventListener('change', e => {
    setMediaOutputEnabled(e.target.checked);
    if (e.target.checked && state.isPlaying) startMediaOutput();
  });
}

function initModalsAndFullscreen() {
  $('fxBtn')?.addEventListener('click', () => $('fxModal').classList.add('active'));
  $('fxClose')?.addEventListener('click', () => $('fxModal').classList.remove('active'));
  $('statsBtn')?.addEventListener('click', () => {
    renderStats();
    $('statsModal').classList.add('active');
  });
  $('statsClose')?.addEventListener('click', () => $('statsModal').classList.remove('active'));

  $('fullscreenBtn')?.addEventListener('click', () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(err => {
        console.error(`Error attempting to enable full-screen mode: ${err.message} (${err.name})`);
      });
    } else {
      document.exitFullscreen();
    }
  });
  document.addEventListener('fullscreenchange', () => {
    document.body.classList.toggle('fullscreen-mode', !!document.fullscreenElement);
  });
}

export function initControls() {
  initPitchControls();
  initTempoControls();
  initTransport();
  initOptions();
  initModalsAndFullscreen();
}
