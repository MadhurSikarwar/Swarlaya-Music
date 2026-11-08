/**
 * Record straight into the Audio Lab: the microphone (with the browser's voice
 * processing off — it would pump the tabla's dynamics) into a MediaRecorder,
 * with a level meter, until Stop. The take becomes the tabla recording, like a
 * chosen file. Nothing is played back while recording.
 */
import { getAudioContext } from '../core/audio-context.js';
import { acquireMic, micSupported, releaseMic } from '../core/mic.js';
import { extensionFor, pickMimeType } from '../lehra/recorder.js';

export const canRecord = () => micSupported() && typeof MediaRecorder !== 'undefined';

/**
 * Start recording. `onLevel(0–1, seconds)` is called each frame for the meter.
 * Resolves { stop() → Promise<File>, cancel() }.
 */
export async function startRecording({ onLevel = () => {} } = {}) {
  const stream = await acquireMic();
  const mime = pickMimeType(t => MediaRecorder.isTypeSupported(t));
  let rec;
  try {
    rec = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 256000 } : undefined);
  } catch (err) {
    releaseMic();
    throw err;
  }
  const chunks = [];
  rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
  const ctx = getAudioContext();
  if (ctx.state === 'suspended') await ctx.resume();
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  source.connect(analyser);
  const buf = new Float32Array(analyser.fftSize);
  const started = performance.now();
  let raf = 0;
  let peakHold = 0;
  const meter = () => {
    analyser.getFloatTimeDomainData(buf);
    let peak = 0;
    for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i]));
    peakHold = Math.max(peak, peakHold * 0.92);
    onLevel(peakHold, (performance.now() - started) / 1000);
    raf = requestAnimationFrame(meter);
  };
  rec.start(1000);
  meter();

  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    cancelAnimationFrame(raf);
    source.disconnect();
    releaseMic();
  };
  return {
    stop: () => new Promise((resolve, reject) => {
      rec.onstop = () => {
        finish();
        const type = rec.mimeType || mime || 'audio/webm';
        const blob = new Blob(chunks, { type });
        if (!blob.size) return reject(new Error('Nothing was recorded.'));
        const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
        resolve(new File([blob], `tabla-take-${stamp}.${extensionFor(type)}`, { type }));
      };
      rec.stop();
    }),
    cancel: () => {
      rec.onstop = null;
      if (rec.state !== 'inactive') rec.stop();
      finish();
    },
  };
}
