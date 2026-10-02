/**
 * Share links that carry their whole content in the URL hash — nothing is
 * uploaded. Used for compositions (#n=…, notation/library.js) and Lehra
 * setups (#s=…, lehra/settings.js).
 */

function toBase64Url(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text) {
  const b = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

async function pipe(bytes, stream) {
  const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

/** Object → hash payload: 'z' + deflated base64url, or 'j' + plain base64url without CompressionStream. */
export async function encodeShare(obj) {
  const json = new TextEncoder().encode(JSON.stringify(obj));
  if (typeof CompressionStream === 'function') {
    return 'z' + toBase64Url(await pipe(json, new CompressionStream('deflate-raw')));
  }
  return 'j' + toBase64Url(json);
}

export async function decodeShare(payload) {
  const kind = payload[0], bytes = fromBase64Url(payload.slice(1));
  let json;
  if (kind === 'z') {
    if (typeof DecompressionStream !== 'function') throw new Error('This browser can’t open compressed links');
    json = await pipe(bytes, new DecompressionStream('deflate-raw'));
  } else if (kind === 'j') {
    json = bytes;
  } else {
    throw new Error('Unrecognised link');
  }
  return JSON.parse(new TextDecoder().decode(json));
}

/** The payload of `key` in a URL hash like "#n=z…" (or "#…&s=z…"), or null. */
export function hashParam(hash, key) {
  const m = new RegExp(`(?:^#|&)${key}=([A-Za-z0-9_-]+)`).exec(hash || '');
  return m ? m[1] : null;
}
