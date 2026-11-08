/**
 * Draws the server's before/after spectrograms (log frequency, 40 Hz–16 kHz,
 * bytes 0–255 for −100…−30 dBFS) with the site's ember-to-gold colours.
 * Both are drawn on the same scale, so a brighter picture is a louder one.
 */
import { decodeBytes, formatClock, heatColor } from './format.js';

let palette = null;
function lookup() {
  if (!palette) palette = Array.from({ length: 256 }, (_, v) => heatColor(v));
  return palette;
}

export function drawSpectrogram(canvas, spec) {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(canvas.clientWidth * dpr)), h = Math.max(1, Math.round(canvas.clientHeight * dpr));
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d');
  g.clearRect(0, 0, w, h);
  if (!spec) return;
  const bytes = decodeBytes(spec.data);
  const { columns, rows } = spec;
  const image = new ImageData(columns, rows);
  const colours = lookup();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      const [R, G, B] = colours[bytes[r * columns + c]];
      const o = ((rows - 1 - r) * columns + c) * 4;   // low frequencies at the bottom
      image.data[o] = R; image.data[o + 1] = G; image.data[o + 2] = B; image.data[o + 3] = 255;
    }
  }
  const tmp = document.createElement('canvas');
  tmp.width = columns;
  tmp.height = rows;
  tmp.getContext('2d').putImageData(image, 0, 0);
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(tmp, 0, 0, w, h);

  // frequency guides
  g.font = `${11 * dpr}px Outfit, sans-serif`;
  g.textBaseline = 'middle';
  for (const [hz, label] of [[100, '100 Hz'], [1000, '1 kHz'], [10000, '10 kHz']]) {
    const y = h * (1 - Math.log(hz / spec.f_low) / Math.log(spec.f_high / spec.f_low));
    g.fillStyle = 'rgba(255,255,255,0.14)';
    g.fillRect(0, y, w, dpr);
    g.fillStyle = 'rgba(237,224,204,0.85)';
    g.fillText(label, 6 * dpr, Math.min(h - 8 * dpr, Math.max(8 * dpr, y - 8 * dpr)));
  }
  g.textBaseline = 'alphabetic';
  g.textAlign = 'right';
  g.fillStyle = 'rgba(237,224,204,0.85)';
  g.fillText(formatClock(spec.seconds), w - 6 * dpr, h - 6 * dpr);
}
