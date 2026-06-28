import React, { useEffect, useMemo, useState } from 'react';
import {
  collection,
  doc,
  getDoc,
  getDocs,
} from 'firebase/firestore';
import { db } from './firebase';
import FranceMap from './FranceMap';

const fallbackDepartments = [
  {
    name: 'Sarthe',
    code: '72',
    level: 'Vert',
    reason: 'Situation conforme au niveau attendu pour la période.',
  },
];

const fallbackBulletin = {
  title: 'Bulletin national ApprentiFR',
  level: 'Vert',
  summary:
    'Aucune vigilance particulière publiée pour le moment. Le marché observé ne présente pas de tension nationale majeure.',
  status: 'published',
  updatedAt: null,
};

const levelLabels = {
  Vert: 'Situation favorable',
  Jaune: 'À surveiller',
  Orange: 'Tendu',
  Rouge: 'Critique',
};

const levelDescriptions = {
  Vert: 'Le marché observé reste favorable ou conforme au niveau attendu.',
  Jaune: 'Des signaux nécessitent une surveillance renforcée.',
  Orange: 'Des tensions significatives sont observées sur certains territoires ou secteurs.',
  Rouge: 'La situation est fortement dégradée et demande une réaction rapide.',
};

const adviceByLevel = {
  Vert: [
    'Maintenir une recherche active.',
    'Candidater régulièrement sur les offres récentes.',
    'Préparer un suivi clair des candidatures envoyées.',
  ],
  Jaune: [
    'Surveiller l’évolution locale dans les prochains jours.',
    'Élargir légèrement la zone de recherche.',
    'Relancer les entreprises déjà contactées.',
  ],
  Orange: [
    'Élargir la recherche aux départements voisins.',
    'Multiplier les candidatures ciblées.',
    'Contacter CFA, missions locales et réseaux professionnels.',
  ],
  Rouge: [
    'Élargir fortement la zone de recherche.',
    'Mobiliser rapidement les structures d’accompagnement.',
    'Prévoir des solutions alternatives selon le calendrier de formation.',
  ],
};

function normalizeLevel(level) {
  return ['Vert', 'Jaune', 'Orange', 'Rouge'].includes(level) ? level : 'Vert';
}

function getLevelClass(level) {
  return String(level || 'Vert').toLowerCase();
}

function formatDate(value) {
  if (!value) {
    return 'Date non disponible';
  }

  if (value?.toDate) {
    return value.toDate().toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    });
  }

  if (typeof value === 'string') {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleDateString('fr-FR', {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
      });
    }

    return value;
  }

  return 'Date non disponible';
}

function countByLevel(departments) {
  return departments.reduce(
    (accumulator, department) => {
      const level = normalizeLevel(department.level);
      accumulator[level] = (accumulator[level] || 0) + 1;
      return accumulator;
    },
    {
      Vert: 0,
      Jaune: 0,
      Orange: 0,
      Rouge: 0,
    }
  );
}

function sortByVigilance(departments) {
  const order = {
    Rouge: 0,
    Orange: 1,
    Jaune: 2,
    Vert: 3,
  };

  return [...departments].sort((a, b) => {
    const levelA = order[normalizeLevel(a.level)] ?? 99;
    const levelB = order[normalizeLevel(b.level)] ?? 99;

    if (levelA !== levelB) {
      return levelA - levelB;
    }

    return String(a.code).localeCompare(String(b.code));
  });
}

export default function PublicHomePage() {
  const [departments, setDepartments] = useState(fallbackDepartments);
  const [bulletin, setBulletin] = useState(fallbackBulletin);
  const [loading, setLoading] = useState(true);
  const [dataSource, setDataSource] = useState('Données publiées');

  useEffect(() => {
    let isMounted = true;

    async function loadPublicData() {
      try {
        setLoading(true);

        const [departmentsSnapshot, bulletinSnapshot] = await Promise.all([
          getDocs(collection(db, 'departments')),
          getDoc(doc(db, 'bulletins', 'national-current')),
        ]);

        if (!isMounted) {
          return;
        }

        const firestoreDepartments = departmentsSnapshot.docs.map((document) => ({
          id: document.id,
          ...document.data(),
        }));

        if (firestoreDepartments.length > 0) {
          setDepartments(firestoreDepartments);
        }

        if (bulletinSnapshot.exists()) {
          const bulletinData = {
            ...fallbackBulletin,
            ...bulletinSnapshot.data(),
          };

          if (bulletinData.status === 'published') {
            setBulletin(bulletinData);
          }
        }

        setDataSource('Mise à jour quotidienne');
      } catch (error) {
        console.error('Erreur chargement accueil public :', error);
        setDataSource('Données temporairement indisponibles');
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    loadPublicData();

    return () => {
      isMounted = false;
    };
  }, []);

  const normalizedBulletinLevel = normalizeLevel(bulletin.level);

  const counts = useMemo(() => countByLevel(departments), [departments]);

  const monitoredDepartments = useMemo(() => {
    return sortByVigilance(
      departments.filter((department) => normalizeLevel(department.level) !== 'Vert')
    );
  }, [departments]);

  const advice = adviceByLevel[normalizedBulletinLevel] || adviceByLevel.Vert;

  return (
    <div className="public-page">
      <header className={`public-hero public-hero-${getLevelClass(normalizedBulletinLevel)}`}>
        <nav className="public-nav">
          <div className="public-brand">
            <span className="public-brand-mark">A</span>
            <div>
              <strong>ApprentiFR</strong>
              <small>Observatoire du marché de l’apprentissage</small>
            </div>
          </div>

          <div className="public-nav-links">
            <a href="#carte">Carte</a>
            <a href="#bulletin">Bulletin</a>
            <a href="#methode">Méthode</a>
          </div>
        </nav>

        <section className="public-hero-content">
          <div>
            <p className="public-kicker">Bulletin national publié</p>
            <h1>Comprendre l’état du marché de l’apprentissage, département par département.</h1>
            <p>
              ApprentiFR publie une lecture simple des tensions observées sur le marché de
              l’apprentissage : situation nationale, carte par département et conseils d’action.
            </p>

            <div className="public-hero-actions">
              <a href="#carte">Voir la carte</a>
              <a href="#bulletin" className="secondary">Lire le bulletin</a>
            </div>
          </div>

          <aside className={`public-hero-bulletin level-${getLevelClass(normalizedBulletinLevel)}`}>
            <span>Niveau national</span>
            <strong>{normalizedBulletinLevel}</strong>
            <p>{levelLabels[normalizedBulletinLevel]}</p>
            <small>Dernière publication : {formatDate(bulletin.updatedAt)}</small>
          </aside>
        </section>
      </header>

      <main className="public-main">
        <section className="public-kpi-grid">
          <article>
            <span>Départements favorables</span>
            <strong>{counts.Vert}</strong>
          </article>
          <article className="yellow">
            <span>À surveiller</span>
            <strong>{counts.Jaune}</strong>
          </article>
          <article className="orange">
            <span>Tendus</span>
            <strong>{counts.Orange}</strong>
          </article>
          <article className="red">
            <span>Critiques</span>
            <strong>{counts.Rouge}</strong>
          </article>
        </section>

        <section className="public-section public-bulletin-section" id="bulletin">
          <article className="public-bulletin-card">
            <p className="public-kicker">Bulletin du jour</p>
            <div className={`public-level-pill level-${getLevelClass(normalizedBulletinLevel)}`}>
              {normalizedBulletinLevel} · {levelLabels[normalizedBulletinLevel]}
            </div>

            <h2>{bulletin.title || 'Bulletin national ApprentiFR'}</h2>
            <p>{bulletin.summary}</p>

            <div className="public-bulletin-note">
              <strong>Lecture rapide</strong>
              <span>{levelDescriptions[normalizedBulletinLevel]}</span>
            </div>
          </article>

          <article className="public-advice-card">
            <p className="public-kicker">Conseils pratiques</p>
            <h2>Que faire maintenant ?</h2>

            <div className="public-advice-list">
              {advice.map((item) => (
                <div key={item} className="public-advice-item">
                  <span>✓</span>
                  <p>{item}</p>
                </div>
              ))}
            </div>
          </article>
        </section>

        <section className="public-section public-map-section" id="carte">
          <div className="public-section-heading">
            <div>
              <p className="public-kicker">Carte nationale</p>
              <h2>Vigilance apprentissage par département</h2>
            </div>
            <p>
              La carte affiche les niveaux validés et publiés. Les suggestions IA restent
              réservées à l’espace admin avant validation humaine.
            </p>
          </div>

          <div className="public-map-card">
            {loading ? (
              <p>Chargement de la carte…</p>
            ) : (
              <FranceMap
                departments={departments}
                title="Département sélectionné"
                emptyTitle="Sélectionne un département"
                emptyText="Clique sur la carte pour consulter le niveau publié et son motif."
                onSelectDepartment={(code) => {
                  window.location.href = "/bulletin/" + encodeURIComponent(code);
                }}
              />
            )}
          </div>
        </section>

        <section className="public-section public-watch-section">
          <div className="public-section-heading">
            <div>
              <p className="public-kicker">Territoires</p>
              <h2>Départements en vigilance publiée</h2>
            </div>
            <p>{dataSource}</p>
          </div>

          {monitoredDepartments.length > 0 ? (
            <div className="public-watch-grid">
              {monitoredDepartments.slice(0, 12).map((department) => (
                <article key={department.id || department.code} className="public-department-card" onClick={() => { window.location.href = "/bulletin/" + encodeURIComponent(department.code); }}>
                  <div>
                    <strong>
                      {department.name} ({department.code})
                    </strong>
                    <p>{department.reason || 'Motif non renseigné.'}</p>
                  </div>

                  <span className={`public-level-pill small level-${getLevelClass(department.level)}`}>
                    {department.level}
                  </span>
                </article>
              ))}
            </div>
          ) : (
            <div className="public-empty-card">
              Aucun département en vigilance renforcée pour le moment.
            </div>
          )}
        </section>

        <section className="public-section public-method-section" id="methode">
          <div className="public-section-heading">
            <div>
              <p className="public-kicker">Méthode</p>
              <h2>Comment lire ApprentiFR ?</h2>
            </div>
            <p>
              Les niveaux publiés reposent sur des données observées et une validation humaine.
              Ils aident à décider, ils ne remplacent pas l’accompagnement local.
            </p>
          </div>

          <div className="public-method-grid">
            <article>
              <span>01</span>
              <h3>Données observées</h3>
              <p>
                Les volumes publiés décrivent les offres visibles dans les sources exploitées.
                Ils ne prétendent pas couvrir l’intégralité du marché.
              </p>
            </article>

            <article>
              <span>02</span>
              <h3>Lecture territoriale</h3>
              <p>
                Le niveau départemental donne un repère simple pour identifier les zones
                favorables, à surveiller ou tendues.
              </p>
            </article>

            <article>
              <span>03</span>
              <h3>Validation humaine</h3>
              <p>
                Les bulletins publics sont validés avant publication. Les analyses IA restent
                internes tant qu’elles ne sont pas confirmées.
              </p>
            </article>
          </div>
        </section>
    </main>

      <footer className="public-footer">
        <strong>ApprentiFR</strong>
        <span>Observatoire du marché de l’apprentissage.</span>
      </footer>
    </div>
  );
}
