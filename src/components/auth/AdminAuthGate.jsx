import React, { useEffect, useState } from 'react';
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../../firebase.js';

export default function AdminAuthGate({ children }) {
  const [user, setUser] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (cancelled) return;

      setReady(false);
      setError('');
      setUser(currentUser);
      setIsAdmin(false);

      if (!currentUser) {
        setReady(true);
        return;
      }

      try {
        const userSnapshot = await getDoc(doc(db, 'users', currentUser.uid));

        if (cancelled) return;

        setIsAdmin(
          userSnapshot.exists() && userSnapshot.data()?.role === 'admin'
        );
      } catch (currentError) {
        if (!cancelled) {
          setError(
            currentError?.message ||
              'Impossible de vérifier les droits d’administration.'
          );
        }
      } finally {
        if (!cancelled) setReady(true);
      }
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
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
          <h1>Vérification en cours</h1>
          <p>Contrôle de la session et des droits d’administration.</p>
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

  if (!isAdmin) {
    return (
      <main className="auth-page">
        <section className="auth-card">
          <p className="kicker">Administration</p>
          <h1>Accès refusé</h1>
          <p>
            Le compte <strong>{user.email || user.displayName || user.uid}</strong>{' '}
            est authentifié, mais ne possède pas le rôle administrateur.
          </p>

          {error ? <div className="state-box error-box">{error}</div> : null}

          <button className="primary-button" type="button" onClick={handleLogout}>
            Se déconnecter
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
