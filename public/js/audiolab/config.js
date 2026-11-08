/**
 * Where the Audio Lab service lives.
 *
 * The page talks to /api/master/… on its own address, the way the Stem
 * Separator talks to /api/… — put the service behind the same host (a reverse
 * proxy or a Vercel rewrite of /api/master/:path*, see the README) and nothing
 * here needs changing.  If the service is somewhere else, set AUDIO_LAB_API to
 * its full address, e.g. 'https://audio.example.com/api/master' (it must allow
 * this site's origin: AUDIO_LAB_CORS_ORIGINS).
 */
export const AUDIO_LAB_API = '/api/master';

/** Tried when the page is opened from this computer and the line above has no service behind it (docker compose --profile audio up). */
export const LOCAL_FALLBACK = 'http://localhost:8100/api/master';

/** Used before the server has said what it allows. */
export const DEFAULT_LIMITS = { max_upload_mb: 500, max_side_upload_mb: 100 };
