/** Metronome click sounds (classic samples, beep, woodblock) with taal accents. */
import { audio } from './audio.js';
import { state } from './state.js';
import { matraInCycle } from './theka.js';

let sounds = null;     // the classic samples: { click, accent, clickOffset, accentOffset }
let loading = null;

/**
 * Where a decoded click actually starts. The .aac clicks carry ~37 ms of
 * AAC encoder priming (like the lehra files), which would make every click
 * late; decoders differ in how much of it they keep, so find the attack.
 */
export function attackOffset(samples, sampleRate) {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
  const threshold = 0.02 * peak;
  let i = 0;
  while (i < samples.length && Math.abs(samples[i]) <= threshold) i++;
  return Math.max(0, i - Math.round(0.0007 * sampleRate)) / sampleRate; // keep the attack's first ms
}

/**
 * Fetch the classic click samples and decode them with `decode(bytes)`:
 * { click, accent, clickOffset, accentOffset } (offsets = seconds of
 * silence before each sample's attack).
 */
export async function decodeClickSounds(decode) {
  const load = url => fetch(url).then(r => r.arrayBuffer()).then(decode);
  const [click, accent] = await Promise.all([load('/assets/Metronome.aac'), load('/assets/MetronomeUp.aac')]);
  return {
    click, accent,
    clickOffset: attackOffset(click.getChannelData(0), click.sampleRate),
    accentOffset: attackOffset(accent.getChannelData(0), accent.sampleRate),
  };
}

/** Fetch and decode the classic click samples (once); resolves when ready. */
export function loadMetronomeSounds() {
  if (!audio.ctx) return Promise.resolve();
  if (!loading) {
    loading = decodeClickSounds(b => audio.ctx.decodeAudioData(b))
      .then(s => { sounds = s; })
      .catch(err => { loading = null; console.error(err); });
  }
  return loading;
}

/** `countIn`: a count-in beat, heard even when the metronome is off. */
export function scheduleMetronome(time, beatIndex, subBeat = 0, countIn = false) {
  if (!state.metronomeEnabled && !(countIn && subBeat === 0)) return;
  playClick(audio.ctx, audio.gainMetronome, time, {
    taal: state.playingTaal || state.taalData,
    beatIndex, subBeat,
    sound: state.metronomeSound,
    accents: state.metronomeAccents,
    sounds,
  });
}

/**
 * One metronome click into `dest` at `time` (in `ctx`'s time) — used live
 * and by the audio export. `beatIndex` is the 0-based beat in the loop,
 * `subBeat` > 0 a subdivision; `sounds` the decoded classic samples.
 */
export function playClick(ctx, dest, time, { taal, beatIndex, subBeat = 0, sound, accents, sounds }) {
  // Position in the taal cycle (a loop may hold two cycles, e.g. Roopak Double)
  const matra = taal ? matraInCycle(taal, beatIndex + 1) : beatIndex + 1;
  const isSam   = matra === 1;
  const isKhali = taal?.khali?.includes(matra);
  const isTaali = taal?.taali?.includes(matra);

  // When accents are OFF: every beat is treated as a plain beat regardless
  // of its taal position. Sam, Khali, and Taali all sound identical.
  const useAccents = accents;
  // Sam (beat 1) is ALWAYS accented — it marks the top of the cycle.
  // Only Taali/Khali differentiation is suppressed when accents are off.
  const effectiveSam   = isSam;                   // always loud on 1
  const effectiveTaali = useAccents && isTaali;
  const effectiveKhali = useAccents && isKhali;

  if (sound === 'classic') {
    if (!sounds) return;
    const src = ctx.createBufferSource();
    const accent = subBeat === 0 && (effectiveSam || effectiveTaali);
    src.buffer = accent ? sounds.accent : sounds.click;

    const srcGain = ctx.createGain();
    if (subBeat > 0) srcGain.gain.value = 0.3;
    else if (effectiveKhali) srcGain.gain.value = 0.4;
    else srcGain.gain.value = 1.0;

    src.connect(srcGain);
    srcGain.connect(dest);
    src.start(time, accent ? sounds.accentOffset : sounds.clickOffset);
  } else if (sound === 'beep') {
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = 'sine';

    let freq = 440;
    if (subBeat > 0)         freq = 600;
    else if (effectiveSam)   freq = 880;
    else if (effectiveTaali) freq = 660;
    else if (effectiveKhali) freq = 330;

    osc.frequency.value = freq;

    let vol = 1;
    if (subBeat > 0)         vol = 0.3;
    else if (effectiveKhali) vol = 0.5;

    env.gain.setValueAtTime(0, time);
    env.gain.linearRampToValueAtTime(vol, time + 0.01);
    env.gain.exponentialRampToValueAtTime(0.001, time + 0.1);
    osc.connect(env);
    env.connect(dest);
    osc.start(time);
    osc.stop(time + 0.1);
  } else if (sound === 'woodblock') {
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = 'triangle';

    let freq = 800;
    if (subBeat > 0)         freq = 600;
    else if (effectiveSam)   freq = 1000;
    else if (effectiveTaali) freq = 900;
    else if (effectiveKhali) freq = 700;

    osc.frequency.value = freq;

    let vol = 1;
    if (subBeat > 0)         vol = 0.4;
    else if (effectiveKhali) vol = 0.6;

    env.gain.setValueAtTime(0, time);
    env.gain.linearRampToValueAtTime(vol, time + 0.005);
    env.gain.exponentialRampToValueAtTime(0.001, time + 0.05);
    osc.connect(env);
    env.connect(dest);
    osc.start(time);
    osc.stop(time + 0.05);
  }
}
