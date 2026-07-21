import React, { useEffect, useState } from 'react';
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import { auth } from '../../firebase.js';

export default function AdminAuthGate({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setReady(true);
    });

    return unsubscribe;
  }, []);

  async function handleLogin() {
    try {
      setError('');
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (currentError) {
      setError(currentError?.message || 'Connexion impossible.');
    }
  }

  async function handleLogout() {
    try {
      setError('');
      await signOut(auth);
    } catch (currentError) {
      setError(currentError?.message || 'Déconnexion impossible.');
    }
  }

  if (!ready) {
    return (
      <main className="auth-page">
        <section className="auth-card">
          <p className="kicker">Administration</p>
          <h1>Chargement</h1>
          <p>Vérification de la session administrateur.</p>
        </section>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="auth-page">
        <section className="auth-card">
          <p className="kicker">Administration</p>
          <h1>Connexion requise</h1>
          <p>
            L’espace admin donne accès aux données de pilotage, brouillons,
            cartes à publier, secteurs, entreprises et imports.
          </p>

          {error ? <div className="state-box error-box">{error}</div> : null}

          <button className="primary-button" type="button" onClick={handleLogin}>
            Se connecter avec Google
          </button>

          <a className="secondary-link" href="/">
            Retour à la carte publique
          </a>
        </section>
      </main>
    );
  }

  return (
    <>
      <div className="admin-session-bar">
        <span>
          Connecté : <strong>{user.email || user.displayName || 'Administrateur'}</strong>
        </span>
        <button type="button" onClick={handleLogout}>
          Déconnexion
        </button>
      </div>

      {children}
    </>
  );
}
