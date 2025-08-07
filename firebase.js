// firebase.js
import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: "AIzaSyAqt7hmR7-6HD9_7POct-CAfmc_GJexnaI",
  authDomain: "studyplanner-de3f9.firebaseapp.com",
  projectId: "studyplanner-de3f9",
  storageBucket: "studyplanner-de3f9.appspot.com",
  messagingSenderId: "366973424044",
  appId: "1:366973424044:android:474fbcd8cd6f96b4a26a09",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

export { app, auth, db, storage };