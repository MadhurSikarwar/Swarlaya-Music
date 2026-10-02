/**
 * Web Worker (classic) for the Lehra audio export's MP3 files: encodes with
 * LAME (lamejs), off the main thread. lamejs is ~150 KB, so it's fetched from
 * cdnjs the first time someone exports an MP3, and only run if it matches
 * the SHA-512 hash cdnjs publishes for it.
 *
 *   → { type: 'start', channels, sr, kbps }  ← { type: 'ready' }
 *   → { type: 'data', pcm: [Int16Array…] }   ← { type: 'ack' }       (one array per channel)
 *   → { type: 'end' }                        ← { type: 'done', blob }
 *                                            ← { type: 'error', message }
 */
const LAME_URL = 'https://cdnjs.cloudflare.com/ajax/libs/lamejs/1.2.1/lame.min.js';
const LAME_SHA512 = 'xT0S/xXvkrfkRXGBPlzZPCAncnMK5c1N7slRkToUbv8Z901aUEuKO84tLy8dWU+3ew4InFEN7TebPaVMy2npZw==';
const FRAMES_PER_CALL = 1152 * 32;

let lame = null;     // Promise: LAME loaded
let encoder = null;
let parts = [];

async function loadLame() {
  let res;
  try {
    res = await fetch(LAME_URL);
  } catch {
    throw new Error("Couldn't load the MP3 encoder. Check your internet connection, or export a WAV instead.");
  }
  if (!res.ok) throw new Error(`Couldn't load the MP3 encoder (${res.status}). Export a WAV instead.`);
  const code = await res.arrayBuffer();
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-512', code));
  if (btoa(String.fromCharCode(...digest)) !== LAME_SHA512) {
    throw new Error('The MP3 encoder failed its integrity check, so it was not used. Export a WAV instead.');
  }
  const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
  try {
    importScripts(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function keep(bytes) {
  if (bytes.length) parts.push(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.length).slice());
}

self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'start') {
      if (!lame) {
        lame = loadLame();
        lame.catch(() => { lame = null; });
      }
      await lame;
      encoder = new lamejs.Mp3Encoder(data.channels, data.sr, data.kbps);
      parts = [];
      self.postMessage({ type: 'ready' });
    } else if (data.type === 'data') {
      const [left, right] = data.pcm;
      for (let i = 0; i < left.length; i += FRAMES_PER_CALL) {
        const l = left.subarray(i, i + FRAMES_PER_CALL);
        keep(right ? encoder.encodeBuffer(l, right.subarray(i, i + FRAMES_PER_CALL)) : encoder.encodeBuffer(l));
      }
      self.postMessage({ type: 'ack' });
    } else if (data.type === 'end') {
      keep(encoder.flush());
      const blob = new Blob(parts, { type: 'audio/mpeg' });
      parts = [];
      self.postMessage({ type: 'done', blob });
    }
  } catch (err) {
    self.postMessage({ type: 'error', message: err.message });
  }
};
