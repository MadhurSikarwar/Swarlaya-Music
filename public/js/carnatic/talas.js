/**
 * Carnatic talas and their kriyas (the hand actions that keep the tala).
 *
 * Suladi talas are built from angas:
 *   laghu (I)       a clap, then finger counts from the little finger
 *                   towards the thumb; its length is the jati
 *                   (tisra 3, chatusra 4, khanda 5, misra 7, sankeerna 9)
 *   drutam (O)      a clap and a wave (2 beats)
 *   anudrutam (U)   a clap (1 beat)
 * In 2-kalai each akshara is held for a second count.
 *
 * Chapu talas are kept by beat groups, with a clap on the first beat of
 * each group (Misra Chapu 3+2+2: claps on 1, 4, 6; Khanda Chapu 2+3:
 * claps on 1, 3) and the other beats counted silently.
 */

export const JATIS = { tisra: 3, chatusra: 4, khanda: 5, misra: 7, sankeerna: 9 };

export const SULADI = {
  dhruva: ['I', 'O', 'I', 'I'],
  matya: ['I', 'O', 'I'],
  rupaka: ['O', 'I'],
  jhampa: ['I', 'U', 'O'],
  triputa: ['I', 'O', 'O'],
  ata: ['I', 'I', 'O', 'O'],
  eka: ['I'],
};

const FINGERS = ['little', 'ring', 'middle', 'index', 'thumb'];
const SUBSCRIPT = { 3: '₃', 4: '₄', 5: '₅', 7: '₇', 9: '₉' };

// The talas offered by name (any other suladi tala: family + jati).
export const TALAS = {
  adi: { name: 'Adi', family: 'triputa', jati: 'chatusra' },
  rupaka: { name: 'Rupaka', family: 'rupaka', jati: 'chatusra' },
  misraChapu: { name: 'Misra Chapu', groups: [3, 2, 2] },
  khandaChapu: { name: 'Khanda Chapu', groups: [2, 3] },
  tisraTriputa: { name: 'Tisra Triputa', family: 'triputa', jati: 'tisra' },
  khandaAta: { name: 'Khanda Ata', family: 'ata', jati: 'khanda' },
  misraJhampa: { name: 'Misra Jhampa', family: 'jhampa', jati: 'misra' },
  chatusraMatya: { name: 'Chatusra Matya', family: 'matya', jati: 'chatusra' },
  chatusraDhruva: { name: 'Chatusra Dhruva', family: 'dhruva', jati: 'chatusra' },
  chatusraEka: { name: 'Chatusra Eka', family: 'eka', jati: 'chatusra' },
  tisraEka: { name: 'Tisra Eka', family: 'eka', jati: 'tisra' },
};

function cap(s) {
  return s[0].toUpperCase() + s.slice(1);
}

/**
 * The beats of a tala — { kind, finger?, anga, first } per count, where
 * kind is 'clap' | 'wave' | 'finger' | 'count' (silent) | 'hold' (2-kalai)
 * — with its angas ({ symbol, start, length }) and a display name.
 */
export function talaStructure(def, kalai = 1) {
  const beats = [];
  const angas = [];
  const push = (b, anga) => {
    beats.push({ ...b, anga, first: beats.length === angas[anga].start });
    for (let k = 1; k < kalai; k++) beats.push({ kind: 'hold', anga, first: false });
  };
  if (def.groups) {
    def.groups.forEach((len, g) => {
      angas.push({ symbol: String(len), start: beats.length, length: len * kalai });
      for (let i = 0; i < len; i++) push({ kind: i === 0 ? 'clap' : 'count' }, g);
    });
    return { name: def.name, beats, angas, notation: def.groups.join('+') };
  }
  const n = JATIS[def.jati];
  SULADI[def.family].forEach((symbol, a) => {
    const count = symbol === 'I' ? n : symbol === 'O' ? 2 : 1;
    angas.push({ symbol: symbol === 'I' ? `I${SUBSCRIPT[n]}` : symbol, start: beats.length, length: count * kalai });
    push({ kind: 'clap' }, a);
    if (symbol === 'I') for (let i = 1; i < n; i++) push({ kind: 'finger', finger: FINGERS[(i - 1) % FINGERS.length] }, a);
    if (symbol === 'O') push({ kind: 'wave' }, a);
  });
  return {
    name: def.name || `${cap(def.jati)} jati ${cap(def.family)}`,
    beats,
    angas,
    notation: angas.map(a => a.symbol).join(' '),
  };
}

/** What a beat is shown as, e.g. "Clap", "Wave", "Ring finger", "·". */
export function kriyaLabel(beat) {
  switch (beat.kind) {
    case 'clap': return 'Clap';
    case 'wave': return 'Wave';
    case 'finger': return `${cap(beat.finger)}${beat.finger === 'thumb' ? '' : ' finger'}`;
    case 'hold': return '(hold)';
    default: return '·';
  }
}

// Shruti names: kattai numbers → Sa (the octave men and women sing Sa in)
export const KATTAI = [
  ['1', 'C', 130.81], ['1½', 'C#', 138.59], ['2', 'D', 146.83], ['2½', 'D#', 155.56],
  ['3', 'E', 164.81], ['4', 'F', 174.61], ['4½', 'F#', 185.0], ['5', 'G', 196.0],
  ['5½', 'G#', 207.65], ['6', 'A', 220.0], ['6½', 'A#', 233.08], ['7', 'B', 246.94],
];
