/**
 * Shared microphone access for the tuner and the riyaz recorder: one
 * getUserMedia stream, released when its last user is done. The browser's
 * voice processing (echo cancellation, noise suppression, auto gain) is
 * off — it would bend pitch and level. Users only ever feed the stream to
 * analysis or recording nodes, never to the speakers.
 */
let stream = null;
let pending = null;
let users = 0;

export function micSupported() {
  return !!(typeof navigator !== 'undefined' && navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}

/** Resolves to the microphone MediaStream (asks for permission the first time). */
export async function acquireMic() {
  if (!micSupported()) throw new Error('This browser has no microphone access');
  users++;
  if (stream) return stream;
  if (!pending) {
    pending = navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    }).then(s => {
      if (users === 0) { s.getTracks().forEach(t => t.stop()); return null; } // released meanwhile
      stream = s;
      return s;
    }).finally(() => { pending = null; });
  }
  try {
    const s = await pending;
    if (!s) throw new Error('Microphone released');
    return s;
  } catch (err) {
    users = Math.max(0, users - 1);
    throw err;
  }
}

export function releaseMic() {
  users = Math.max(0, users - 1);
  if (users === 0 && stream) {
    stream.getTracks().forEach(t => t.stop());
    stream = null;
  }
}
