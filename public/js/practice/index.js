/**
 * Practise along with any song (/practice?job=<id>): the accompaniment of a
 * finished stem separation — no_vocals.mp3, or the sum of the non-vocal
 * stems — played through a Lehra engine in song mode (one segment that is
 * the whole track), transposed to your Sa and at your own speed, live, with
 * loop on/off and seeking. Separations expire an hour after they were made,
 * so every request copes with a 404.
 */
import { $, fillSlider, trackSliderFill } from '../core/dom.js';
import { getAudioContext } from '../core/audio-context.js';
import { getMasterOutput, outputLatency, startMediaOutput, stopMediaOutput } from '../core/audio-output.js';
import { clearMediaSession, setMediaPlaybackState, showMediaSession } from '../core/media-session.js';
import { LehraEngine, buildTanpuraLoop, songBpm } from '../lehra/engine.js';
import { TANPURA_BASE_HZ, TANPURA_URL, state as lehraState } from '../lehra/state.js';
import { addInto, formatTime, shiftToSa, toMono } from './song.js';

const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NOTES = [['C', 130.81], ['C#', 138.59], ['D', 146.83], ['D#', 155.56], ['E', 164.81], ['F', 174.61],
  ['F#', 185.0], ['G', 196.0], ['G#', 207.65], ['A', 220.0], ['A#', 233.08], ['B', 246.94]];
const STEM_LABEL = { no_vocals: 'Accompaniment', vocals: 'Vocals' };
const MAX_SEMITONES = 12;

let engine = null;
let engineReady = null;
let songGain = null;
let droneGain = null;
let job = null;          // { id, stems: [], bytes: Map(stem → Promise<ArrayBuffer>) }
let song = null;         // { id, len, sr } — the mix the engine has
let mixRequest = 0;
let playing = false;
let resumeAt = 0;        // position (0–1) to start from when not playing
let semitones = 0;
let speed = 1;
let looping = true;
let posTimer = 0;
let seeking = false;
let usingMediaOutput = false; // this page took the lock-screen output

function message(text, isError = false) {
  const el = $('practiceMessage');
  el.textContent = text;
  el.classList.toggle('error', isError);
  el.hidden = !text;
}

function status(text) {
  $('practiceStatus').textContent = text;
}

function expired() {
  stop();
  $('practiceControls').hidden = true;
  message('This separation has expired — results are kept for one hour. Separate the song again in the Stem Separator, then choose “Practise along”.', true);
  $('practiceSeparatorLink').hidden = false;
}

async function api(path) {
  const res = await fetch(path);
  if (res.status === 404) { const e = new Error('expired'); e.expired = true; throw e; }
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res;
}

function mySa() {
  return NOTES[parseInt($('practiceMySa').value, 10)][1];
}

// ── Engine ─────────────────────────────────────────────────────────
function ensureEngine() {
  if (!engineReady) {
    engineReady = (async () => {
      const ctx = getAudioContext();
      songGain = ctx.createGain();
      droneGain = ctx.createGain();
      songGain.connect(getMasterOutput());
      droneGain.connect(getMasterOutput());
      applyVolumes();
      const e = new LehraEngine(ctx);
      await e.init(songGain, droneGain);
      e.onEnded = () => { playing = false; resumeAt = 0; syncTransport(); setMediaPlaybackState('paused'); };
      engine = e;
      // A tanpura at your Sa, for those who want one (volume starts at 0)
      e.decode(TANPURA_URL)
        .then(a => e.setTanpura(buildTanpuraLoop(a.getChannelData(0), a.sampleRate, 64)))
        .catch(err => console.warn('Tanpura load error:', err));
    })();
    engineReady.catch(() => { engineReady = null; });
  }
  return engineReady;
}

function params() {
  return {
    bpm: songBpm(song.len, song.sr) * speed,
    pitch: Math.pow(2, semitones / 12),
    tanpuraRatio: mySa() / TANPURA_BASE_HZ,
    loop: looping,
  };
}

function applyVolumes() {
  if (!songGain) return;
  const t = getAudioContext().currentTime;
  songGain.gain.setTargetAtTime(+$('practiceSongVol').value / 100, t, 0.02);
  droneGain.gain.setTargetAtTime(+$('practiceDroneVol').value / 100, t, 0.02);
}

// ── Stems → mix ────────────────────────────────────────────────────
function stemBytes(stem) {
  if (!job.bytes.has(stem)) {
    const p = api(`/api/stems/${job.id}/${stem}.mp3`).then(r => r.arrayBuffer());
    p.catch(() => job.bytes.delete(stem));
    job.bytes.set(stem, p);
  }
  return job.bytes.get(stem);
}

function selectedStems() {
  return [...document.querySelectorAll('#practiceStems input:checked')].map(i => i.value);
}

/** Decode and mix the ticked stems, then hand the mix to the engine (crossfading if playing). */
async function buildMix() {
  const id = ++mixRequest;
  const stems = selectedStems();
  if (!stems.length) { status('Tick at least one stem.'); return; }
  await ensureEngine();
  const ctx = getAudioContext();
  let pcm = null;
  try {
    for (let i = 0; i < stems.length; i++) {
      status(`Loading ${STEM_LABEL[stems[i]] || stems[i]} (${i + 1}/${stems.length})…`);
      const buffer = await ctx.decodeAudioData((await stemBytes(stems[i])).slice(0));
      if (id !== mixRequest) return;
      pcm = addInto(pcm, toMono(buffer)); // one decoded stem at a time: keeps memory down
    }
  } catch (err) {
    if (err.expired) { expired(); return; }
    status(`Couldn't load the stems: ${err.message}`);
    return;
  }
  if (id !== mixRequest) return;
  const songId = `song:${job.id}:${stems.join('+')}:${id}`;
  engine.loadSong(songId, pcm, ctx.sampleRate);
  const old = song;
  song = { id: songId, len: pcm.length, sr: ctx.sampleRate };
  $('practiceDur').textContent = formatTime(song.len / song.sr);
  if (playing && old) {
    engine.setParams(params());
    engine.switchRaag(songId, false); // same position, crossfaded
  }
  if (old) engine.unload(old.id);
  status('');
  $('practiceControls').hidden = false;
  message('');
}

// ── Transport ──────────────────────────────────────────────────────
function position() {
  if (!song) return 0;
  if (!playing) return resumeAt;
  const b = engine.beatAt(getAudioContext().currentTime - outputLatency());
  return b === null ? resumeAt : b - Math.floor(b);
}

const MEDIA_ACTIONS = { play: () => play(), pause: () => pause(), stop: () => stop() };

function mediaInfo() {
  const name = job && sessionStorage.getItem(`practice-name-${job.id}`);
  const st = semitones ? ` · ${semitones > 0 ? '+' : ''}${semitones} st` : '';
  return { title: name || 'Practise along', artist: `${Math.round(speed * 100)}% speed${st}`, album: 'Swaralaya' };
}

async function play() {
  if (!song || playing) return;
  startMediaOutput(); // within the click, for lock-screen controls
  usingMediaOutput = true;
  await ensureEngine();
  const ctx = getAudioContext();
  if (ctx.state === 'suspended') await ctx.resume();
  engine.play(song.id, { ...params(), startPhase: resumeAt });
  playing = true;
  syncTransport();
  showMediaSession(mediaInfo(), MEDIA_ACTIONS);
}

function pause() {
  if (!playing) return;
  resumeAt = position();
  engine.stop();
  playing = false;
  syncTransport();
  setMediaPlaybackState('paused');
}

function stop() {
  if (engine && playing) engine.stop();
  playing = false;
  resumeAt = 0;
  syncTransport();
  clearMediaSession(MEDIA_ACTIONS);
  if (usingMediaOutput) {
    stopMediaOutput();
    usingMediaOutput = false;
  }
}

function syncTransport() {
  $('practicePlayIcon').style.display = playing ? 'none' : '';
  $('practicePauseIcon').style.display = playing ? '' : 'none';
  $('practiceLoop').classList.toggle('active', looping);
  clearInterval(posTimer);
  if (playing) posTimer = setInterval(showPosition, 200);
  showPosition();
}

function showPosition() {
  if (!song || seeking) return;
  const p = position();
  $('practicePos').textContent = formatTime(p * song.len / song.sr);
  $('practiceSeek').value = Math.round(p * 1000);
  fillSlider($('practiceSeek'));
}

function setSemitones(v) {
  semitones = Math.max(-MAX_SEMITONES, Math.min(MAX_SEMITONES, v));
  $('practiceSemis').textContent = `${semitones > 0 ? '+' : ''}${semitones}`;
  if (engine && song) engine.setParams({ pitch: Math.pow(2, semitones / 12) });
  if (playing) showMediaSession(mediaInfo(), MEDIA_ACTIONS);
}

function setSpeed(v) {
  speed = Math.max(0.5, Math.min(1.5, Math.round(v * 100) / 100));
  $('practiceSpeed').value = Math.round(speed * 100);
  fillSlider($('practiceSpeed'));
  $('practiceSpeedVal').textContent = `${Math.round(speed * 100)}%`;
  if (engine && song) engine.setParams({ bpm: songBpm(song.len, song.sr) * speed });
  if (playing) showMediaSession(mediaInfo(), MEDIA_ACTIONS);
}

// ── Opening a job ──────────────────────────────────────────────────
function renderStems(stems) {
  const wrap = $('practiceStems');
  wrap.innerHTML = '';
  for (const s of stems) {
    const label = document.createElement('label');
    label.className = 'toggle-label';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.className = 'toggle-checkbox';
    box.value = s;
    box.checked = s !== 'vocals'; // the accompaniment; add the vocals to hear the original
    box.addEventListener('change', buildMix);
    const slider = document.createElement('span');
    slider.className = 'toggle-slider';
    const text = document.createElement('span');
    text.className = 'toggle-text';
    text.textContent = STEM_LABEL[s] || s[0].toUpperCase() + s.slice(1);
    label.append(box, slider, text);
    wrap.appendChild(label);
  }
}

/** Load the job named in the URL (if it isn't the one already open). */
export async function openPracticeFromUrl() {
  if (window.location.pathname.replace(/\/$/, '') !== '/practice') return;
  const id = new URLSearchParams(window.location.search).get('job');
  if (job && job.id === id) return;
  stop();
  $('practiceControls').hidden = true;
  $('practiceSeparatorLink').hidden = true;
  if (!id) {
    message('Separate a song in the Stem Separator, then choose “Practise along” to play its accompaniment here.');
    $('practiceSeparatorLink').hidden = false;
    return;
  }
  if (!JOB_ID.test(id)) { message('This practice link isn’t valid.', true); return; }
  message('Opening your separation…');
  try {
    let info;
    for (;;) {
      info = await (await api(`/api/job_status/${id}`)).json();
      if (info.status === 'completed') break;
      if (info.status === 'error') { message(`The separation failed: ${info.error || 'unknown error'}`, true); return; }
      message(`Still separating (${info.progress || 0}%)… this page will be ready when it finishes.`);
      await new Promise(r => setTimeout(r, 3000));
    }
    const stems = Array.isArray(info.stems) && info.stems.length ? info.stems : ['vocals', 'drums', 'bass', 'guitar', 'piano', 'other'];
    job = { id, stems, bytes: new Map() };
    const name = sessionStorage.getItem(`practice-name-${id}`);
    $('practiceTitle').textContent = name ? `“${name}” — the accompaniment, at your Sa and your tempo.` : 'The accompaniment of your song, at your Sa and your tempo.';
    renderStems(stems);
    resumeAt = 0;
    await buildMix();
  } catch (err) {
    if (err.expired) expired();
    else message(`Couldn't open the separation: ${err.message}`, true);
  }
}

/** Stop playback (leaving the page). */
export function leavePractice() {
  if (playing) pause();
}

/** Sa the tuner should measure against on this page. */
export function practiceSa() {
  return mySa();
}

export function initPractice() {
  if (!$('view-practice')) return;
  const my = $('practiceMySa'), songSa = $('practiceSongSa');
  NOTES.forEach(([n, hz], i) => {
    my.add(new Option(`${n} (${hz.toFixed(2)} Hz)`, String(i)));
    songSa.add(new Option(n, String(i)));
  });
  // Your Sa: the Lehra player's, to the nearest note
  const nearest = NOTES.reduce((best, [, hz], i) =>
    Math.abs(Math.log(hz / lehraState.pitchHz)) < Math.abs(Math.log(NOTES[best][1] / lehraState.pitchHz)) ? i : best, 0);
  my.value = String(nearest);
  my.addEventListener('change', () => { if (engine && song) engine.setParams({ tanpuraRatio: mySa() / TANPURA_BASE_HZ }); });
  $('practiceMatch').addEventListener('click', () => {
    if (songSa.value === '') { status('Pick the song’s Sa first.'); return; }
    setSemitones(shiftToSa(NOTES[+songSa.value][1], mySa()));
    status(`Transposed ${semitones >= 0 ? 'up' : 'down'} ${Math.abs(semitones)} semitone${Math.abs(semitones) === 1 ? '' : 's'} to your Sa.`);
  });
  $('practiceSemiDown').addEventListener('click', () => setSemitones(semitones - 1));
  $('practiceSemiUp').addEventListener('click', () => setSemitones(semitones + 1));
  $('practiceSpeed').addEventListener('input', e => setSpeed(+e.target.value / 100));
  $('practiceSlower').addEventListener('click', () => setSpeed(speed - 0.05));
  $('practiceFaster').addEventListener('click', () => setSpeed(speed + 0.05));
  $('practicePlay').addEventListener('click', () => (playing ? pause() : play()));
  $('practiceStop').addEventListener('click', stop);
  $('practiceLoop').addEventListener('click', () => {
    looping = !looping;
    if (engine) engine.setParams({ loop: looping });
    syncTransport();
  });
  const seek = $('practiceSeek');
  seek.addEventListener('input', () => {
    seeking = true;
    if (song) $('practicePos').textContent = formatTime(+seek.value / 1000 * song.len / song.sr);
  });
  seek.addEventListener('change', () => {
    seeking = false;
    const p = Math.min(0.999, +seek.value / 1000);
    if (playing) engine.seek(p);
    else resumeAt = p;
    showPosition();
  });
  $('practiceSongVol').addEventListener('input', applyVolumes);
  $('practiceDroneVol').addEventListener('input', applyVolumes);
  ['practiceSeek', 'practiceSpeed', 'practiceSongVol', 'practiceDroneVol'].forEach(id => trackSliderFill($(id)));
  window.addEventListener('popstate', () => openPracticeFromUrl());
  setSemitones(0);
  setSpeed(1);
  syncTransport();
}
