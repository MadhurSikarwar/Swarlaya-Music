/**
 * Accounts — "Continue with Google" on the Your Progress page, which keeps the
 * riyaz log and game scores in step across a person's devices — run on
 * Firebase (Authentication + Cloud Firestore), straight from the browser, so
 * they work on a static host such as Vercel.
 *
 * To switch them on, create a Firebase project and paste its web app config
 * below (README → "Accounts" has the steps). The config identifies the
 * project; it is not a secret — access is controlled by the sign-in itself
 * and by the Firestore rules in firestore.rules.
 *
 * While this is null the site simply has no sign-in: everything stays on the
 * device, exactly as before.
 */
export const FIREBASE_CONFIG = null;

/* Example:
export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSy…',
  authDomain: 'your-project.firebaseapp.com',
  projectId: 'your-project',
  appId: '1:123456789012:web:abcdef123456',
};
*/

/** The Firebase web SDK, loaded from Google's CDN only when someone signs in. */
export const FIREBASE_SDK = 'https://www.gstatic.com/firebasejs/12.19.0';
