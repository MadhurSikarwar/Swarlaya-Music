/**
 * Vercel Function: signed upload URLs for the Audio Lab (POST /api/master-upload).
 *
 * A function cannot receive more than 4.5 MB, so the page sends a recording
 * straight to Vercel Blob with `uploadPresigned` (public/js/vendor/vercel-blob-client.js):
 * the browser asks here for a URL, this answers with one that can upload only
 * that one pathname, of that size, for half an hour — no Blob credentials ever
 * reach the browser. The pathnames are audio-lab/<job>/in/<role>-<8 hex>.<ext>: <job> is
 * 128 random bits chosen by the page, the same key the Python function
 * (audio_lab/serverless.py) checks every input against.
 */
import { issueSignedToken } from '@vercel/blob';
import { handleUploadPresigned } from '@vercel/blob/client';

const MB = 1024 * 1024;
const MAX_MB = { tabla: 150, recorder: 150, lehra: 50, reference: 50, vocal: 50 };
const EXTENSIONS = new Set(['wav', 'mp3', 'm4a', 'aac', 'flac', 'ogg', 'oga', 'opus', 'mp4', 'mov', 'mkv', 'webm',
  'avi', 'aif', 'aiff', 'wma', 'caf']);
const PATHNAME = /^audio-lab\/[0-9a-f]{32}\/in\/(tabla|lehra|reference|recorder|vocal)(?:-[0-9a-f]{8})?\.([a-z0-9]{1,5})$/;
const VALID_MS = 30 * 60 * 1000;

const reply = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
});

/** The URL a recording may be uploaded to, or an Error for anything else. */
export async function signedUpload(pathname) {
  const m = PATHNAME.exec(pathname || '');
  if (!m || !EXTENSIONS.has(m[2])) throw new Error('That upload is not allowed.');
  const maximumSizeInBytes = MAX_MB[m[1]] * MB;
  const validUntil = Date.now() + VALID_MS;
  const token = await issueSignedToken({
    pathname, operations: ['put'], maximumSizeInBytes, allowedContentTypes: ['audio/*', 'video/*'], validUntil,
  });
  return {
    token,
    urlOptions: {
      maximumSizeInBytes, allowedContentTypes: ['audio/*', 'video/*'], validUntil,
      addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 3600,
    },
  };
}

export default {
  async fetch(request) {
    if (request.method !== 'POST') return reply({ error: 'Not found.' }, 405);
    const origin = request.headers.get('origin');
    if (origin && new URL(origin).host !== new URL(request.url).host) return reply({ error: 'Not allowed.' }, 403);
    let body;
    try {
      body = await request.json();
    } catch {
      return reply({ error: 'That request was not understood.' }, 400);
    }
    try {
      return reply(await handleUploadPresigned({ body, request, getSignedToken: signedUpload }));
    } catch (err) {
      return reply({ error: err instanceof Error ? err.message : 'The upload could not be started.' }, 400);
    }
  },
};
