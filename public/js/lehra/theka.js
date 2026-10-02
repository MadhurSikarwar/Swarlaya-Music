/**
 * Taal structure helpers: the role of each matra (sam / taali / khali), the
 * Bhatkhande vibhag markers (X, 2, 0, 3 …) and the theka laid out per matra.
 *
 * A catalogue taal describes ONE cycle (taali, khali, theka) and may hold
 * `cycles` whole cycles per recorded loop (e.g. Roopak Double Cycle = 2 × 7),
 * so matras are first folded into their cycle.
 */

function cycleLength(taal) {
  return taal.beats / (taal.cycles || 1);
}

/** 1-based position of loop matra `matra` within its cycle. */
export function matraInCycle(taal, matra) {
  const len = cycleLength(taal);
  return ((matra - 1) % len + len) % len + 1;
}

/** 'sam' | 'taali' | 'khali' | null for loop matra `matra` (1-based). */
export function matraRole(taal, matra) {
  if (!taal) return null;
  const m = matraInCycle(taal, matra);
  if (m === 1) return 'sam';
  if (taal.taali?.includes(m)) return 'taali';
  if (taal.khali?.includes(m)) return 'khali';
  return null;
}

/**
 * Vibhag markers for one cycle, keyed by matra: sam is X (0 when sam is
 * khali, as in Roopak), khali 0, and the other taalis are numbered in order.
 */
export function vibhagMarkers(taal) {
  const starts = [...new Set([1, ...(taal.taali || []), ...(taal.khali || [])])].sort((a, b) => a - b);
  const samIsKhali = taal.khali?.includes(1);
  let n = samIsKhali ? 1 : 2;
  const markers = new Map();
  for (const m of starts) {
    if (m === 1) markers.set(m, samIsKhali ? '0' : 'X');
    else if (taal.khali?.includes(m)) markers.set(m, '0');
    else markers.set(m, String(n++));
  }
  return markers;
}

/** The theka's vibhags (arrays of bols) for one cycle, or null if the taal has none. */
export function thekaVibhags(taal) {
  if (!taal?.theka) return null;
  return taal.theka.split('|').map(v => v.trim().split(/\s+/));
}

/**
 * One avartan (cycle) matra by matra, as the taal circle draws it:
 * { length, matras: [{ matra, role, marker, bol }] }. `marker` is set on the
 * first matra of each vibhag, `bol` is '' when the taal has no theka.
 */
export function taalCycle(taal) {
  const length = cycleLength(taal);
  const markers = vibhagMarkers(taal);
  const vibhags = thekaVibhags(taal);
  const bols = vibhags && vibhags.flat().length === length ? vibhags.flat() : null;
  const matras = [];
  for (let m = 1; m <= length; m++) {
    matras.push({ matra: m, role: matraRole(taal, m), marker: markers.get(m) || '', bol: bols ? bols[m - 1] : '' });
  }
  return { length, matras };
}

/**
 * One entry per matra of the whole loop — { matra, bol, marker } where
 * marker is set on the first matra of each vibhag — or null without a theka.
 */
export function thekaMatras(taal) {
  const vibhags = thekaVibhags(taal);
  if (!vibhags) return null;
  const len = cycleLength(taal);
  if (vibhags.flat().length !== len) return null;
  const markers = vibhagMarkers(taal);
  const out = [];
  for (let c = 0; c < (taal.cycles || 1); c++) {
    let m = 1;
    for (const v of vibhags) {
      v.forEach((bol, i) => {
        out.push({ matra: c * len + m, bol, marker: i === 0 ? (markers.get(m) || '') : '' });
        m++;
      });
    }
  }
  return out;
}
