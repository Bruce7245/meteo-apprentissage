import React, { useEffect, useState } from 'react';
import {
  FiArrowLeft,
  FiCheckCircle,
  FiEye,
  FiEyeOff,
  FiLock,
  FiMail,
  FiShield,
} from 'react-icons/fi';
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

function AdminAuthBrandPanel() {
  return (
    <aside className="admin-auth-brand-panel">
      <a className="admin-auth-brand" href="/">
        <span className="admin-console-logo" aria-hidden="true">AF</span>
        <span>
          <strong>ApprentiFR</strong>
          <small>Observatoire territorial de l’apprentissage</small>
        </span>
      </a>

      <div className="admin-auth-brand-copy">
        <p className="admin-console-eyebrow">Administration</p>
        <h2>Console de pilotage sécurisée</h2>
        <p>
          Accédez aux publications, analyses métiers, données entreprises et
          outils de contrôle depuis un espace réservé aux administrateurs.
        </p>
      </div>

      <div className="admin-auth-security-list">
        <div>
          <FiShield aria-hidden="true" />
          <span>
            <strong>Contrôle serveur</strong>
            <small>Les droits admin sont vérifiés après authentification.</small>
          </span>
        </div>
        <div>
          <FiCheckCircle aria-hidden="true" />
          <span>
            <strong>Session navigateur</strong>
            <small>La connexion n’est pas persistée comme session permanente.</small>
          </span>
        </div>
      </div>
    </aside>
  );
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
      setError(
        'Saisissez votre adresse e-mail avant de demander un nouveau mot de passe.'
      );
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
      <main className="admin-auth-page">
        <AdminAuthBrandPanel />

        <section className="admin-auth-content">
          <div className="admin-auth-card admin-auth-card-loading">
            <span className="admin-console-loader" />
            <p className="admin-console-eyebrow">Sécurité</p>
            <h1>Vérification de la session</h1>
            <p>
              Contrôle de l’authentification et des droits administrateur.
            </p>
          </div>
        </section>
      </main>
    );
  }

  if (!user || !session) {
    return (
      <main className="admin-auth-page">
        <AdminAuthBrandPanel />

        <section className="admin-auth-content">
          <div className="admin-auth-card">
            <div className="admin-auth-card-head">
              <span className="admin-auth-lock">
                <FiLock aria-hidden="true" />
              </span>
              <div>
                <p className="admin-console-eyebrow">Accès sécurisé</p>
                <h1>Connexion administrateur</h1>
              </div>
            </div>

            <p className="admin-auth-intro">
              Utilisez le compte administrateur autorisé pour accéder à la
              console.
            </p>

            {error ? (
              <div className="state-box error-box" role="alert">
                {error}
              </div>
            ) : null}

            {notice ? (
              <div className="state-box auth-notice" role="status">
                {notice}
              </div>
            ) : null}

            <form className="auth-form" onSubmit={handleLogin}>
              <label className="auth-field">
                <span>Adresse e-mail</span>
                <div className="admin-auth-input">
                  <FiMail aria-hidden="true" />
                  <input
                    type="email"
                    name="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    autoComplete="username"
                    inputMode="email"
                    placeholder="admin@exemple.fr"
                    required
                    disabled={busy}
                  />
                </div>
              </label>

              <label className="auth-field">
                <span>Mot de passe</span>
                <div className="admin-auth-input admin-auth-password">
                  <FiLock aria-hidden="true" />
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
                    className="admin-auth-password-toggle"
                    type="button"
                    onClick={() =>
                      setShowPassword((value) => !value)
                    }
                    disabled={busy}
                    aria-label={
                      showPassword
                        ? 'Masquer le mot de passe'
                        : 'Afficher le mot de passe'
                    }
                  >
                    {showPassword ? (
                      <FiEyeOff aria-hidden="true" />
                    ) : (
                      <FiEye aria-hidden="true" />
                    )}
                  </button>
                </div>
              </label>

              <div className="admin-auth-form-actions">
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
              </div>
            </form>

            <div className="admin-auth-footer">
              <a href="/">
                <FiArrowLeft aria-hidden="true" />
                Retour au site public
              </a>
              <small>
                La session est limitée à ce navigateur et les droits sont
                contrôlés côté serveur après connexion.
              </small>
            </div>
          </div>
        </section>
      </main>
    );
  }

  return (
    <>
      <div className="admin-session-bar">
        <span>
          Connecté :{' '}
          <strong>
            {session.email || user.email || 'Administrateur'}
          </strong>
        </span>
        <button type="button" onClick={handleLogout} disabled={busy}>
          {busy ? 'Déconnexion…' : 'Déconnexion'}
        </button>
      </div>

      {children}
    </>
  );
}
