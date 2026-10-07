import React, { useEffect, useState } from 'react';
import {
  browserSessionPersistence,
  onAuthStateChanged,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth';
import { auth } from '../../firebase.js';
import {
  recordAdminLogout,
  verifyAdminSession,
} from '../../services/adminSessionService.js';

function loginErrorMessage(error) {
  switch (error?.code) {
    case 'auth/invalid-credential':
    case 'auth/invalid-email':
    case 'auth/user-disabled':
    case 'auth/user-not-found':
    case 'auth/wrong-password':
      return 'Identifiants incorrects ou accès administrateur non autorisé.';
    case 'auth/too-many-requests':
      return 'Trop de tentatives de connexion. Réessayez plus tard.';
    case 'auth/network-request-failed':
      return 'Connexion au service d’authentification impossible.';
    default:
      return 'Connexion impossible.';
  }
}

export default function AdminAuthGate({ children }) {
  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let cancelled = false;
    let unsubscribe = () => {};

    async function initializeAdminAuth() {
      try {
        await setPersistence(auth, browserSessionPersistence);
      } catch {
        if (!cancelled) {
          setError(
            'Impossible de sécuriser la persistance de la session administrateur.'
          );
          setReady(true);
        }
        return;
      }

      if (cancelled) return;

      unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
        if (cancelled) return;

        setReady(false);
        setUser(null);
        setSession(null);

        if (!currentUser) {
          setReady(true);
          return;
        }

        try {
          const result = await verifyAdminSession(currentUser);

          if (cancelled) return;

          setUser(currentUser);
          setSession(result.session || null);
          setError('');
          setNotice('');
        } catch (currentError) {
          try {
            await signOut(auth);
          } catch {
            // La session sera considérée comme refusée même si la déconnexion locale échoue.
          }

          if (!cancelled) {
            setError(
              currentError?.status === 401 || currentError?.status === 403
                ? 'Identifiants incorrects ou accès administrateur non autorisé.'
                : 'Impossible de vérifier les droits d’administration.'
            );
          }
        } finally {
          if (!cancelled) setReady(true);
        }
      });
    }

    initializeAdminAuth();

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  async function handleLogin(event) {
    event.preventDefault();

    const cleanEmail = email.trim();

    if (!cleanEmail || !password) {
      setError('Saisissez votre adresse e-mail et votre mot de passe.');
      return;
    }

    try {
      setBusy(true);
      setError('');
      setNotice('');
      await signInWithEmailAndPassword(auth, cleanEmail, password);
      setPassword('');
    } catch (currentError) {
      setError(loginErrorMessage(currentError));
    } finally {
      setBusy(false);
    }
  }

  async function handlePasswordReset() {
    const cleanEmail = email.trim();

    if (!cleanEmail) {
      setError('Saisissez votre adresse e-mail avant de demander un nouveau mot de passe.');
      return;
    }

    try {
      setBusy(true);
      setError('');
      setNotice('');

      await sendPasswordResetEmail(auth, cleanEmail);

      setNotice(
        'Si un compte correspond à cette adresse, un e-mail de réinitialisation a été envoyé.'
      );
    } catch (currentError) {
      if (
        currentError?.code === 'auth/user-not-found' ||
        currentError?.code === 'auth/invalid-email'
      ) {
        setNotice(
          'Si un compte correspond à cette adresse, un e-mail de réinitialisation a été envoyé.'
        );
      } else if (currentError?.code === 'auth/too-many-requests') {
        setError('Trop de demandes. Réessayez plus tard.');
      } else {
        setError('Impossible d’envoyer la demande de réinitialisation.');
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleLogout() {
    try {
      setBusy(true);
      setError('');

      try {
        await recordAdminLogout(user);
      } catch {
        // La journalisation ne doit jamais empêcher la déconnexion locale.
      }

      await signOut(auth);
      setSession(null);
      setUser(null);
    } catch {
      setError('Déconnexion impossible.');
    } finally {
      setBusy(false);
    }
  }

  if (!ready) {
    return (
      <main className="auth-page">
        <section className="auth-card">
          <p className="kicker">ApprentiFR · Administration</p>
          <h1>Vérification en cours</h1>
          <p>Contrôle de la session et des droits d’administration.</p>
        </section>
      </main>
    );
  }

  if (!user || !session) {
    return (
      <main className="auth-page">
        <section className="auth-card">
          <p className="kicker">ApprentiFR · Administration</p>
          <h1>Accès sécurisé</h1>
          <p>
            Connexion réservée aux comptes administrateurs autorisés.
            L’authentification utilise une adresse e-mail et un mot de passe.
          </p>

          {error ? <div className="state-box error-box">{error}</div> : null}
          {notice ? <div className="state-box auth-notice">{notice}</div> : null}

          <form className="auth-form" onSubmit={handleLogin}>
            <label className="auth-field">
              <span>Adresse e-mail</span>
              <input
                type="email"
                name="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="username"
                inputMode="email"
                required
                disabled={busy}
              />
            </label>

            <label className="auth-field">
              <span>Mot de passe</span>
              <div className="auth-password-field">
                <input
                  type={showPassword ? 'text' : 'password'}
                  name="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  required
                  disabled={busy}
                />
                <button
                  className="auth-password-toggle"
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  disabled={busy}
                  aria-label={
                    showPassword
                      ? 'Masquer le mot de passe'
                      : 'Afficher le mot de passe'
                  }
                >
                  {showPassword ? 'Masquer' : 'Afficher'}
                </button>
              </div>
            </label>

            <button
              className="primary-button"
              type="submit"
              disabled={busy}
            >
              {busy ? 'Connexion…' : 'Se connecter'}
            </button>

            <button
              className="auth-link-button"
              type="button"
              onClick={handlePasswordReset}
              disabled={busy}
            >
              Mot de passe oublié ?
            </button>
          </form>

          <div className="auth-footer">
            <a className="secondary-link" href="/">
              Retour à la carte publique
            </a>
            <small>
              La session administrateur est limitée à ce navigateur et n’est
              pas conservée comme connexion permanente.
            </small>
          </div>
        </section>
      </main>
    );
  }

  return (
    <>
      <div className="admin-session-bar">
        <span>
          Connecté : <strong>{session.email || user.email || 'Administrateur'}</strong>
        </span>
        <button type="button" onClick={handleLogout} disabled={busy}>
          {busy ? 'Déconnexion…' : 'Déconnexion'}
        </button>
      </div>

      {children}
    </>
  );
}
