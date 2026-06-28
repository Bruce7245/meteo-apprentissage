import React, { useEffect, useState } from 'react';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from './firebase';
import AdminStatsDashboard from './AdminStatsDashboard';

function AdminObservatoryPage() {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      setProfile(null);
      setErrorMessage('');

      if (!currentUser) {
        setLoading(false);
        return;
      }

      try {
        const profileSnapshot = await getDoc(doc(db, 'users', currentUser.uid));

        if (profileSnapshot.exists()) {
          setProfile(profileSnapshot.data());
        } else {
          setProfile(null);
        }
      } catch (error) {
        console.error('Erreur lecture profil admin :', error);
        setErrorMessage('Impossible de vérifier les droits administrateur.');
      } finally {
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

  async function handleLogin(event) {
    event.preventDefault();
    setLoading(true);
    setErrorMessage('');

    try {
      await signInWithEmailAndPassword(auth, email, password);
      setPassword('');
    } catch (error) {
      console.error('Erreur connexion observatoire :', error);
      setErrorMessage('Connexion impossible.');
      setLoading(false);
    }
  }

  async function handleLogout() {
    await signOut(auth);
  }

  if (loading) {
    return (
      <main className="admin-observatory-page">
        <p>Chargement de l’observatoire...</p>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="admin-observatory-login">
        <section className="admin-login-card">
          <p className="admin-kicker">Accès réservé</p>
          <h1>Observatoire ApprentiFR</h1>
          <p>
            Connecte-toi pour accéder aux statistiques avancées. Le tableau ne va pas
            s’ouvrir par magie, il a encore un instinct de survie.
          </p>

          <form onSubmit={handleLogin} className="admin-form">
            <label htmlFor="observatory-email">Email</label>
            <input
              id="observatory-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              required
            />

            <label htmlFor="observatory-password">Mot de passe</label>
            <input
              id="observatory-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
            />

            {errorMessage && <p className="admin-error">{errorMessage}</p>}

            <button type="submit">Se connecter</button>
          </form>
        </section>
      </main>
    );
  }

  if (profile?.role !== 'admin') {
    return (
      <main className="admin-observatory-page">
        <section className="admin-login-card">
          <h1>Accès refusé</h1>
          <p>Ce compte n’a pas les droits administrateur.</p>
          <button type="button" onClick={handleLogout}>
            Déconnexion
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="admin-observatory-page">
      <header className="admin-observatory-header">
        <div>
          <p className="admin-kicker">Pilotage national</p>
          <h1>Observatoire ApprentiFR</h1>
          <p>
            Statistiques avancées, secteurs, départements, journaux d’import et aide
            à l’analyse.
          </p>
        </div>

        <nav className="admin-observatory-actions">
          <a href="/pilotage-bulletins">Bulletins</a>
          <a href="/">Site public</a>
          <button type="button" onClick={handleLogout}>
            Déconnexion
          </button>
        </nav>
      </header>

      <AdminStatsDashboard />
    </main>
  );
}

export default AdminObservatoryPage;
