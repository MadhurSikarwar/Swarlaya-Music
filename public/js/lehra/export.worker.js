/**
 * Web Worker (module) for the Lehra audio export: renders the lehra and
 * tanpura a chunk at a time with the engine's own DSP, off the main thread
 * (see export.js and export-render.js).
 *
 *   ← { type: 'loaded' }                     the module loaded
 *   → { type: 'start', job }                 ← { type: 'ready' }
 *   → { type: 'next', frames }               ← { type: 'chunk', lehra, tanpura } (transferred)
 *                                            ← { type: 'error', message }
 */
import { exportDsp, renderChunk } from './export-render.js';

let dsp = null;
let frame = 0;

self.onmessage = ({ data }) => {
  try {
    if (data.type === 'start') {
      dsp = exportDsp(data.job);
      frame = 0;
      self.postMessage({ type: 'ready' });
    } else if (data.type === 'next') {
      const { lehra, tanpura } = renderChunk(dsp, frame, data.frames);
      frame += data.frames;
      self.postMessage({ type: 'chunk', lehra, tanpura }, [lehra.buffer, tanpura.buffer]);
    }
  } catch (err) {
    self.postMessage({ type: 'error', message: err.message });
  }
};

// Tells export.js this browser runs module workers (else it renders itself)
self.postMessage({ type: 'loaded' });
