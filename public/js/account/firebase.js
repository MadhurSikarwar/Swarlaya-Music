/**
 * The account backend on Firebase: Google sign-in (Authentication) and one
 * document per user (Cloud Firestore, its small REST-only "lite" build).
 * The SDK is imported from Google's CDN only when this is first called, so
 * visitors who never sign in don't download it.
 *
 * A backend is { onUser, signIn, signOut, load, save, remove }; index.js
 * only knows that shape (and tests give it a stand-in).
 */
import { FIREBASE_SDK } from './config.js';

const COLLECTION = 'users';

export async function createFirebaseBackend(config) {
  const [{ initializeApp }, auth] = await Promise.all([
    import(`${FIREBASE_SDK}/firebase-app.js`),
    import(`${FIREBASE_SDK}/firebase-auth.js`),
  ]);
  const app = initializeApp(config);
  const authInstance = auth.getAuth(app);

  // The database module waits until there is something to read or write
  let store = null;
  const firestore = () => {
    store ||= import(`${FIREBASE_SDK}/firebase-firestore-lite.js`).then(m => ({ m, db: m.getFirestore(app) }));
    store.catch(() => { store = null; }); // a failed download can be retried
    return store;
  };
  const userDoc = async uid => {
    const { m, db } = await firestore();
    return { m, ref: m.doc(db, COLLECTION, uid) };
  };

  const describe = u => (u ? { uid: u.uid, name: u.displayName || '', email: u.email || '', photo: u.photoURL || '' } : null);

  return {
    /** cb(user | null) now and whenever the sign-in state changes. */
    onUser(cb) {
      return auth.onAuthStateChanged(authInstance, u => cb(describe(u)));
    },
    async signIn() {
      const provider = new auth.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      await auth.signInWithPopup(authInstance, provider);
    },
    signOut() {
      return auth.signOut(authInstance);
    },
    /** The user's document, or null if they have none yet. */
    async load(uid) {
      const { m, ref } = await userDoc(uid);
      const snap = await m.getDoc(ref);
      return snap.exists() ? snap.data() : null;
    },
    /** Merge `patch` into the user's document (other devices' entries are left alone). */
    async save(uid, patch) {
      const { m, ref } = await userDoc(uid);
      await m.setDoc(ref, { ...patch, v: 1, updatedAt: m.serverTimestamp() }, { merge: true });
    },
    async remove(uid) {
      const { m, ref } = await userDoc(uid);
      await m.deleteDoc(ref);
    },
  };
}
