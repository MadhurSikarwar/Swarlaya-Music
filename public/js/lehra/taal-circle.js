/**
 * Taal circle: one avartan drawn as a chakra, sam at the top and the matras
 * running clockwise, with the vibhag dividers and X / 2 / 0 / 3 markers and
 * the theka's bols inside the ring. While the lehra plays a hand sweeps round
 * it, driven by the engine's own beat clock (the one the metronome and the beat
 * dots follow), so it stays locked to the audio through tempo changes.
 *
 * It listens to the state bus ('settings', 'playback'), so player.js and
 * selection.js don't know about it. Playing, it draws the taal the engine is
 * playing (state.playingTaal); otherwise the selected one.
 */
import { $ } from '../core/dom.js';
import { outputLatency } from '../core/audio-output.js';
import { audio } from './audio.js';
import { CATALOGUE } from './catalogue.js';
import { on, onSettingsChange, state } from './state.js';
import { taalCycle } from './theka.js';

const NS = 'http://www.w3.org/2000/svg';
const VIEW = 240;            // viewBox is VIEW × VIEW, centred on (0, 0)
const RING_R = 78;           // matra nodes sit on this circle
const MARKER_R = 104;        // vibhag markers outside it
const BOL_R = 62;            // bols inside it
const HAND_INNER_R = 46;     // the hand starts outside the centre readout
const RING_LEN = 2 * Math.PI * RING_R;
const CENTRE_W = 84;         // room for the centre readout's bottom line (font-size 12 in the CSS)
const MAX_BOLS = 16;         // more matras than this and the bols would collide
const NODE_R = { sam: 8.5, taali: 6.5, khali: 6.5, plain: 4.5 };
const ROLE_LABEL = { sam: 'SAM', taali: 'TAALI', khali: 'KHALI' };

const reducedMotion = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;

let shown = null;      // the taal drawn now
let els = null;        // handles into the drawn SVG, null while nothing is drawn
let activeIdx = -1;    // matra (0-based) lit now, -1 at rest
let countingIn = false;
let frame = null;

function svgEl(tag, attrs, parent) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v);
  if (parent) parent.appendChild(el);
  return el;
}

/** Position on a circle of radius r, `frac` of the way round clockwise from the top. */
function polar(frac, r) {
  const a = frac * 2 * Math.PI;
  return { x: +(r * Math.sin(a)).toFixed(2), y: +(-r * Math.cos(a)).toFixed(2) };
}

/** 'Teentaal (16 beats)' → 'Teentaal', looked up from the taal object. */
function taalName(taal) {
  for (const inst of Object.values(CATALOGUE)) {
    for (const [name, t] of Object.entries(inst.taals)) {
      if (t === taal) return name.replace(/\s*\(.*\)$/, '');
    }
  }
  return 'Taal';
}

function draw(taal) {
  const host = $('taalCircle');
  if (!host) return;
  shown = taal;
  els = null;
  activeIdx = -1;
  countingIn = false;
  host.replaceChildren();
  host.hidden = !taal;
  $('nowPlayingCard')?.classList.toggle('has-taal', !!taal);
  if (!taal) return;

  const { length: n, matras } = taalCycle(taal);
  const name = taalName(taal);
  const vibhags = matras.filter(m => m.marker).length;
  const svg = svgEl('svg', {
    class: 'taal-svg',
    viewBox: `${-VIEW / 2} ${-VIEW / 2} ${VIEW} ${VIEW}`,
    role: 'img',
    'aria-label': `${name}: ${n} matras${vibhags > 1 ? ` in ${vibhags} vibhags` : ''}`,
  }, host);

  svgEl('circle', { class: 'tc-track', r: RING_R }, svg);
  const arc = svgEl('circle', {
    class: 'tc-arc', r: RING_R, transform: 'rotate(-90)',
    'stroke-dasharray': `0 ${RING_LEN.toFixed(1)}`,
  }, svg);

  const showBols = n <= MAX_BOLS && matras.some(m => m.bol);
  const nodes = matras.map((m, i) => {
    const frac = i / n;
    // Vibhag divider: half a matra before the vibhag's first matra.
    if (m.marker) {
      const a = polar(frac - 0.5 / n, RING_R - 13), b = polar(frac - 0.5 / n, RING_R + 13);
      svgEl('line', { class: 'tc-tick', x1: a.x, y1: a.y, x2: b.x, y2: b.y }, svg);
      const p = polar(frac, MARKER_R);
      svgEl('text', { class: 'tc-marker', x: p.x, y: p.y }, svg).textContent = m.marker;
    }
    const role = m.role || 'plain';
    const p = polar(frac, RING_R);
    const g = svgEl('g', { class: `tc-node ${role}` }, svg);
    svgEl('circle', { class: 'tc-halo', cx: p.x, cy: p.y, r: NODE_R[role] }, g);
    svgEl('circle', { class: 'tc-dot', cx: p.x, cy: p.y, r: NODE_R[role] }, g);
    if (showBols && m.bol) {
      // Down the sides the text extends towards the centre; near the top and
      // bottom, where neighbours sit side by side, it is centred on its matra.
      const q = polar(frac, BOL_R), side = Math.sin(frac * 2 * Math.PI);
      svgEl('text', {
        class: 'tc-bol', x: q.x, y: q.y,
        'text-anchor': side > 0.55 ? 'end' : side < -0.55 ? 'start' : 'middle',
      }, g).textContent = m.bol;
    }
    return g;
  });

  const hand = svgEl('g', { class: 'tc-hand', transform: 'rotate(0)' }, svg);
  svgEl('line', { class: 'tc-hand-line', x1: 0, y1: -HAND_INNER_R, x2: 0, y2: -RING_R }, hand);
  svgEl('circle', { class: 'tc-head', cx: 0, cy: -RING_R, r: 3.2 }, hand);

  const number = svgEl('text', { class: 'tc-num', y: 8 }, svg);
  const label = svgEl('text', { class: 'tc-label', y: 24 }, svg);
  const bol = svgEl('text', { class: 'tc-bolnow', y: 41 }, svg);

  els = { svg, arc, hand, nodes, matras, number, label, bol, length: n, name };
  rest();
}

/** The centre's bottom line — a bol, or the taal's name, shrunk if it wouldn't fit. */
function setCentreText(text) {
  const size = CENTRE_W / (Math.max(text.length, 1) * 0.6);
  els.bol.style.fontSize = size < 12 ? `${size.toFixed(1)}px` : '';
  els.bol.textContent = text;
}

/** Nothing playing: the hand parked at sam and the centre showing the taal. */
function rest() {
  if (!els) return;
  if (activeIdx >= 0) els.nodes[activeIdx].classList.remove('active');
  activeIdx = -1;
  countingIn = false;
  els.svg.classList.remove('count-in');
  els.svg.dataset.role = '';
  els.hand.setAttribute('transform', 'rotate(0)');
  els.arc.setAttribute('stroke-dasharray', `0 ${RING_LEN.toFixed(1)}`);
  els.number.textContent = els.length;
  els.label.textContent = 'MATRAS';
  setCentreText(els.name);
}

function setActive(idx) {
  if (activeIdx >= 0) els.nodes[activeIdx].classList.remove('active');
  els.nodes[idx].classList.add('active');
  activeIdx = idx;
  const m = els.matras[idx];
  els.svg.dataset.role = m.role || '';
  els.number.textContent = m.matra;
  els.label.textContent = countingIn ? 'COUNT-IN' : ROLE_LABEL[m.role] || 'MATRA';
  setCentreText(countingIn ? '' : m.bol);
}

function tick() {
  frame = null;
  if (!state.isPlaying) { rest(); return; }
  frame = requestAnimationFrame(tick);

  // A raag switch can change the taal under a running lehra.
  const taal = state.playingTaal || state.taalData;
  if (taal !== shown) draw(taal);
  if (!els) return;

  const { engine, ctx } = audio;
  // Light each matra when it is heard, not when it is rendered.
  const beat = engine && ctx ? engine.beatAt(ctx.currentTime - outputLatency()) : null;
  if (beat === null) return;

  const n = els.length;
  const pos = ((beat % n) + n) % n;                    // matras since sam of this avartan
  const idx = Math.min(n - 1, Math.floor(pos + 1e-6));
  const deg = (reducedMotion?.matches ? idx : pos) / n * 360;

  const counting = beat < -1e-6;                       // the count-in's beats are negative
  let relabel = false;
  if (counting !== countingIn) {
    countingIn = counting;
    els.svg.classList.toggle('count-in', counting);
    relabel = true;
  }
  els.hand.setAttribute('transform', `rotate(${deg.toFixed(2)})`);
  els.arc.setAttribute('stroke-dasharray', `${(deg / 360 * RING_LEN).toFixed(1)} ${RING_LEN.toFixed(1)}`);
  if (idx !== activeIdx || relabel) setActive(idx);
}

function sync() {
  if (state.isPlaying) {
    if (!frame) frame = requestAnimationFrame(tick);
    return;
  }
  if (frame) { cancelAnimationFrame(frame); frame = null; }
  if (state.taalData !== shown) draw(state.taalData);
  else if (activeIdx !== -1) rest();
}

export function initTaalCircle() {
  onSettingsChange(sync);
  on('playback', sync);
  sync();
}
