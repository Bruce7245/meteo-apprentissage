import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { getAuth } from 'firebase/auth';

const firebaseConfig = {
  projectId: 'meteo-apprentissage',
  appId: '1:506565850175:web:6865dd67e50c16c2e7b48a',
  storageBucket: 'meteo-apprentissage.firebasestorage.app',
  apiKey: 'AIzaSyATDU6HDbc6kIc3VVBaEU1hit2uBS7Ybr8',
  authDomain: 'meteo-apprentissage.firebaseapp.com',
  messagingSenderId: '506565850175',
  measurementId: 'G-CY806GL8Q7',
};

const app = initializeApp(firebaseConfig);

export const db = getFirestore(app);
export const auth = getAuth(app);
export const storage = getStorage(app);
