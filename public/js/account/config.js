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
export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyBemn8ACJ7TWoFryCxfSVnP3pgef0vBLro',
  authDomain: 'swarlaya-5479c.firebaseapp.com',
  projectId: 'swarlaya-5479c',
  storageBucket: 'swarlaya-5479c.firebasestorage.app',
  messagingSenderId: '890437174587',
  appId: '1:890437174587:web:5293cdfdfa5c3f246c631e',
};
// (set this back to null to switch accounts off)

/** The Firebase web SDK, loaded from Google's CDN only when someone signs in. */
export const FIREBASE_SDK = 'https://www.gstatic.com/firebasejs/12.19.0';
