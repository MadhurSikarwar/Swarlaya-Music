/**
 * Notation playback voices, synthesised with Web Audio (there are no tabla
 * samples in the app).
 *
 * Tabla: each bol is one or more strokes on the dayan (right drum, tuned to
 * Sa — its loaded membrane rings in near-harmonic modes 1:2:3:4:5) and/or
 * the bayan (left bass drum, a low boom that settles in pitch, or a dead
 * slap). Compound bols like Dha = Na + Ge sound together; Tirakita etc.
 * split the bol's time into quick strokes.
 *
 * Voice: a sawtooth through three vowel ("aa") formants, with a gentle
 * attack and delayed vibrato.
 */

// Stroke definitions. partials: [ratio to the drum's pitch, level, ring (s)]
const STROKES = {
  na:  { drum: 'dayan', partials: [[1, 0.6, 0.5], [2, 1, 0.45], [3, 0.5, 0.3], [4, 0.3, 0.2], [5, 0.15, 0.12]], click: 0.35, clickHz: 3200 },
  ta:  { drum: 'dayan', partials: [[1, 0.5, 0.35], [2, 1, 0.35], [3, 0.7, 0.25], [4, 0.45, 0.18], [5, 0.3, 0.1]], click: 0.5, clickHz: 3600 },
  tin: { drum: 'dayan', partials: [[1, 0.3, 0.7], [2, 0.5, 0.6], [3, 1, 0.55], [4, 0.4, 0.3]], click: 0.15, clickHz: 2800 },
  tun: { drum: 'dayan', partials: [[1, 1, 1.0], [2, 0.35, 0.5], [3, 0.15, 0.3]], click: 0.1, clickHz: 2000 },
  ti:  { drum: 'dayan', partials: [[1, 0.4, 0.04], [2, 0.5, 0.035], [3, 0.3, 0.03]], click: 0.7, clickHz: 2500 },
  ge:  { drum: 'bayan', partials: [[1, 1, 0.6], [2, 0.25, 0.3]], click: 0.15, clickHz: 600, glide: 1.12 },
  ke:  { drum: 'bayan', partials: [[1, 0.3, 0.03]], click: 0.9, clickHz: 900, lowpass: true },
};

// Bol → strokes; each inner array sounds together, the outer array splits the time.
const BOLS = {
  dha: [['na', 'ge']], dhaa: [['na', 'ge']], dhin: [['tin', 'ge']], dhi: [['tin', 'ge']], din: [['tin', 'ge']],
  dhun: [['tun', 'ge']], dhe: [['ti', 'ge']],
  na: [['na']], naa: [['na']], ta: [['ta']], taa: [['ta']], tin: [['tin']], tun: [['tun']], thun: [['tun']], tu: [['tun']],
  ti: [['ti']], te: [['ti']], tit: [['ti']], ra: [['ti']], re: [['ti']], ri: [['ti']], tak: [['ti']],
  ge: [['ge']], ga: [['ge']], ghe: [['ge']], gi: [['ge']], ghi: [['ge']],
  ke: [['ke']], ka: [['ke']], ki: [['ke']], kat: [['ke']], kath: [['ke']], kattu: [['ke']],
  tete: [['ti'], ['ti']], tita: [['ti'], ['ta']], kita: [['ke'], ['ta']], kata: [['ke'], ['ta']],
  tirakita: [['ti'], ['ti'], ['ke'], ['ta']], tirkit: [['ti'], ['ti'], ['ke'], ['ta']], trkt: [['ti'], ['ti'], ['ke'], ['ta']],
  dhage: [['na', 'ge'], ['ge']], dhere: [['ti', 'ge'], ['ti']], gadi: [['ge'], ['tin']], gana: [['ge'], ['na']],
};
const REST = new Set(['-', '–', 'ऽ', 's', 'x']);

/**
 * Strokes for a bol token (English), e.g. 'Dha' → [['na','ge']],
 * 'TiRaKiTa' → [['ti'],['ti'],['ke'],['ta']]; [] for a rest; unknown bols
 * get a light 'ti' so the rhythm is still heard.
 */
export function bolStrokes(token) {
  const t = String(token).trim().toLowerCase();
  if (!t || REST.has(t)) return [];
  const key = t.replace(/[^a-z]/g, '');
  return BOLS[key] || [['ti']];
}

/** The dayan rings at Sa moved into 220–440 Hz; the bayan at the Pa below, in 70–140 Hz. */
export function drumPitches(sa) {
  const into = (f, lo) => {
    while (f < lo) f *= 2;
    while (f >= 2 * lo) f /= 2;
    return f;
  };
  return { dayan: into(sa, 220), bayan: into(sa * 2 / 3, 70) };
}

let noiseBuffer = null;
function noise(ctx) {
  if (!noiseBuffer || noiseBuffer.sampleRate !== ctx.sampleRate) {
    noiseBuffer = ctx.createBuffer(1, Math.round(ctx.sampleRate * 0.1), ctx.sampleRate);
    const d = noiseBuffer.getChannelData(0);
    let seed = 12345;
    for (let i = 0; i < d.length; i++) {
      seed = (seed * 1103515245 + 12345) >>> 0;
      d[i] = seed / 2147483648 - 1;
    }
  }
  return noiseBuffer;
}

function stroke(ctx, dest, name, time, pitches, velocity) {
  const s = STROKES[name];
  const f0 = pitches[s.drum];
  for (const [ratio, level, ring] of s.partials) {
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    const f = f0 * ratio;
    if (s.glide) {
      osc.frequency.setValueAtTime(f * s.glide, time);
      osc.frequency.exponentialRampToValueAtTime(f, time + 0.08);
    } else {
      osc.frequency.value = f;
    }
    env.gain.setValueAtTime(0, time);
    env.gain.linearRampToValueAtTime(level * velocity * 0.25, time + 0.002);
    env.gain.exponentialRampToValueAtTime(0.0001, time + ring);
    osc.connect(env);
    env.connect(dest);
    osc.start(time);
    osc.stop(time + ring + 0.02);
  }
  if (s.click) {
    const src = ctx.createBufferSource();
    src.buffer = noise(ctx);
    const filter = ctx.createBiquadFilter();
    filter.type = s.lowpass ? 'lowpass' : 'bandpass';
    filter.frequency.value = s.clickHz;
    filter.Q.value = s.lowpass ? 0.7 : 1.2;
    const env = ctx.createGain();
    const len = s.lowpass ? 0.035 : 0.025;
    env.gain.setValueAtTime(0, time);
    env.gain.linearRampToValueAtTime(s.click * velocity * 0.5, time + 0.001);
    env.gain.exponentialRampToValueAtTime(0.0001, time + len);
    src.connect(filter);
    filter.connect(env);
    env.connect(dest);
    src.start(time);
    src.stop(time + len + 0.01);
  }
}

/** Play a bol (English token) starting at `time`, spread over `dur` seconds. */
export function playBol(ctx, dest, token, time, dur, sa, velocity = 1) {
  const parts = bolStrokes(token);
  if (!parts.length) return;
  const pitches = drumPitches(sa);
  const step = dur / parts.length;
  parts.forEach((names, i) => names.forEach(n => stroke(ctx, dest, n, time + i * step, pitches, velocity)));
}

// Vowel "aa" formants: [Hz, level, Q]
const FORMANTS = [[730, 1, 8], [1090, 0.55, 10], [2440, 0.25, 12]];

/** Sing `hz` from `time` for `dur` seconds (gliding in from `from` Hz, if given). */
export function playSwar(ctx, dest, hz, time, dur, from = null) {
  const end = time + dur;
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  if (from && Math.abs(from / hz - 1) > 0.001) {
    osc.frequency.setValueAtTime(from, time);
    osc.frequency.exponentialRampToValueAtTime(hz, time + Math.min(0.07, dur / 3));
  } else {
    osc.frequency.setValueAtTime(hz, time);
  }
  // Vibrato fades in on held notes only
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 5.3;
  const depth = ctx.createGain();
  depth.gain.setValueAtTime(0, time);
  depth.gain.linearRampToValueAtTime(dur > 0.4 ? hz * 0.007 : 0, time + Math.min(dur, 0.45));
  lfo.connect(depth);
  depth.connect(osc.frequency);

  const env = ctx.createGain();
  const attack = Math.min(0.04, dur / 4), release = Math.min(0.08, dur / 3);
  env.gain.setValueAtTime(0, time);
  env.gain.linearRampToValueAtTime(0.6, time + attack);
  env.gain.setValueAtTime(0.6, end - release);
  env.gain.linearRampToValueAtTime(0, end);
  for (const [f, level, q] of FORMANTS) {
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = f;
    bp.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = level;
    osc.connect(bp);
    bp.connect(g);
    g.connect(env);
  }
  // A little of the source itself, low-passed, for body
  const body = ctx.createBiquadFilter();
  body.type = 'lowpass';
  body.frequency.value = 900;
  const bodyGain = ctx.createGain();
  bodyGain.gain.value = 0.18;
  osc.connect(body);
  body.connect(bodyGain);
  bodyGain.connect(env);
  env.connect(dest);
  osc.start(time);
  lfo.start(time);
  osc.stop(end + 0.02);
  lfo.stop(end + 0.02);
}
