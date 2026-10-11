import React, { useEffect, useMemo, useState } from 'react';
import PublicLayout from '../../layouts/PublicLayout.jsx';
import VigilanceMap from '../../components/maps/VigilanceMap.jsx';
import VigilanceLegend from '../../components/vigilance/VigilanceLegend.jsx';
import { getLatestPublicVigilanceIndex } from '../../services/vigilanceService.js';
import { editorialTopics, listPublishedArticles } from '../../content/publicArticles.js';
import ArticleCarousel from '../../components/articles/ArticleCarousel.jsx';
import { ArticleCard, EditorialTopicCard } from '../../components/articles/ArticleCard.jsx';

const levelOrder = ['green', 'yellow', 'orange', 'red'];
const levelMeta = {
  green: { label: 'Favorable', description: 'Vigilance verte' },
  yellow: { label: 'Modérée', description: 'Vigilance jaune' },
  orange: { label: 'Renforcée', description: 'Vigilance orange' },
  red: { label: 'Élevée', description: 'Vigilance rouge' },
};

const destinations = [
  { icon: '⌖', title: 'Explorer les territoires', description: 'Consultez la situation publiée dans chaque département.', href: '#carte', kind: 'map' },
  { icon: '▣', title: 'Explorer les métiers', description: 'Découvrez les secteurs et les métiers observés.', href: '/metiers', kind: 'work' },
  { icon: '↗', title: 'Voir la situation nationale', description: 'Lisez la répartition actuelle des vigilances.', href: '#situation', kind: 'chart' },
  { icon: 'ⓘ', title: 'Comprendre les données', description: 'Découvrez les limites et le sens des indicateurs.', href: '#comprendre', kind: 'help' },
];

function levelForCount(department) {
  const level = department?.publishedLevel || department?.level;
  return levelOrder.includes(level) ? level : null;
}

export default function PublicMapPage() {
  const [index, setIndex] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedDepartment, setSelectedDepartment] = useState('');

  useEffect(() => {
    let alive = true;
    getLatestPublicVigilanceIndex()
      .then(value => { if (alive) setIndex(value); })
      .catch(currentError => { if (alive) setError(currentError?.message || 'Données indisponibles'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const departments = index?.departments || [];
  const featuredArticles = listPublishedArticles().slice(0, 6);
  const sortedDepartments = useMemo(() => [...departments].sort((a, b) => {
    const aName = a.name || a.departmentName || a.code || '';
    const bName = b.name || b.departmentName || b.code || '';
    return aName.localeCompare(bName, 'fr');
  }), [departments]);

  const levelCounts = useMemo(() => departments.reduce((counts, department) => {
    const level = levelForCount(department);
    if (level) counts[level] += 1;
    return counts;
  }, { green: 0, yellow: 0, orange: 0, red: 0 }), [departments]);

  const recognizedCount = levelOrder.reduce((sum, key) => sum + levelCounts[key], 0);
  const missingCount = Math.max(0, departments.length - recognizedCount);

  function openSelectedDepartment(event) {
    event.preventDefault();
    if (selectedDepartment) window.location.assign('/departement/' + encodeURIComponent(selectedDepartment));
  }

  return (
    <PublicLayout>
      <div className="af-home">
        <section className="af-hero" aria-labelledby="af-home-title">
          <div className="af-hero-copy">
            <p className="af-overline">Des données pour mieux comprendre les territoires</p>
            <h1 id="af-home-title">L'apprentissage<br />en France,<br /><span>territoire par territoire.</span></h1>
            <p className="af-hero-lead">ApprentiFR observe les offres, les métiers et les formations en apprentissage pour éclairer les réalités locales, sans promettre de résultats individuels.</p>
            <form className="af-hero-search" onSubmit={openSelectedDepartment} aria-label="Accéder à un département">
              <label htmlFor="af-department-select">Explorer un département</label>
              <div className="af-hero-search-row">
                <select id="af-department-select" value={selectedDepartment} onChange={event => setSelectedDepartment(event.target.value)} disabled={loading || sortedDepartments.length === 0}>
                  <option value="">Choisissez un département...</option>
                  {sortedDepartments.map(department => {
                    const code = department.code || department.departmentCode;
                    return <option key={code} value={code}>{code} — {department.name || department.departmentName || code}</option>;
                  })}
                </select>
                <button type="submit" disabled={!selectedDepartment}>Explorer <span aria-hidden="true">→</span></button>
              </div>
            </form>
            <p className="af-hero-links">Vous cherchez un métier ? <a href="/metiers">Parcourir les secteurs et les métiers <span aria-hidden="true">↗</span></a></p>
          </div>
          <div className="af-hero-art" aria-hidden="true">
            <div className="af-hero-halo" />
            <img src="/apprenti_fr.svg" alt="" className="af-hero-art-mark" />
            <div className="af-hero-art-copy"><span className="af-hero-art-rule" />Chaque territoire a son histoire.<br />Les données aident à la comprendre.</div>
          </div>
        </section>

        <section className="af-quicklinks" aria-label="Explorer ApprentiFR">
          {destinations.map(destination => (
            <a className={'af-quicklink af-quicklink-' + destination.kind} href={destination.href} key={destination.title}>
              <span className="af-quicklink-icon" aria-hidden="true">{destination.icon}</span>
              <strong>{destination.title}</strong>
              <span>{destination.description}</span>
              <span className="af-quicklink-arrow" aria-hidden="true">→</span>
            </a>
          ))}
        </section>

        <section className="af-overview" id="situation" aria-labelledby="af-overview-title">
          <div className="af-overview-intro">
            <p className="af-overline">L'apprentissage aujourd'hui</p>
            <h2 id="af-overview-title">Une vision d'ensemble<br />sur le territoire</h2>
            <p>Une lecture des derniers niveaux de vigilance publiés. Un indicateur de tension ne constitue pas une prévision d'embauche.</p>
            <a href="#carte" className="af-gold-link">Voir la carte <span aria-hidden="true">→</span></a>
          </div>
          <div className="af-vigilance-grid">
            {levelOrder.map(level => (
              <div className={'af-vigilance-card af-vigilance-' + level} key={level}>
                <span className="af-vigilance-bar" aria-hidden="true" />
                <div><strong>{loading || error ? '—' : levelCounts[level]}</strong><span>département{levelCounts[level] > 1 ? 's' : ''}</span><small>{levelMeta[level].label}</small></div>
              </div>
            ))}
            {missingCount > 0 && !loading && !error ? <p className="af-overview-disclaimer">{missingCount} département(s) sans niveau explicite dans l'index.</p> : null}
            {error ? <p className="af-overview-disclaimer" role="status">Les chiffres sont momentanément indisponibles.</p> : null}
          </div>
          <p className="af-overview-date">Dernière publication : {index?.latestDate || 'non disponible'}</p>
        </section>

        <section className="af-articles-preview" id="analyses" aria-labelledby="af-articles-title">
          <div className="af-section-header">
            <div>
              <p className="af-overline">Analyses & articles</p>
              <h2 id="af-articles-title">À la une sur ApprentiFR</h2>
            </div>
            <a href="/articles" className="af-articles-section-action">Accéder aux analyses <span aria-hidden="true">→</span></a>
          </div>
          {featuredArticles.length ? (
            <ArticleCarousel label="Dernières analyses publiées">
              {featuredArticles.map(article => (
                <ArticleCard article={article} key={article.slug} />
              ))}
            </ArticleCarousel>
          ) : (
            <div className="af-editorial-pending">
              <p>Les premières analyses se préparent. Voici les thématiques que nous aborderons prochainement.</p>
              <ArticleCarousel label="Thématiques des prochains articles">
                {editorialTopics.map(topic => (
                  <EditorialTopicCard topic={topic} key={topic.title} />
                ))}
              </ArticleCarousel>
            </div>
          )}
        </section>

        <section className="af-map-editorial" id="carte" aria-labelledby="af-map-title">
          <div className="af-section-header">
            <div><p className="af-overline">Explorer les territoires</p><h2 id="af-map-title">La France, département par département.</h2></div>
            <p>Sélectionnez un territoire pour accéder à son bulletin et découvrir les signaux disponibles.</p>
          </div>
          <div className="public-map-grid">
            <VigilanceMap departments={departments} loading={loading} error={error} latestDate={index?.latestDate} />
            <aside className="public-map-aside">
              <VigilanceLegend />
              <section className="information-card" id="comprendre">
                <p className="eyebrow">Comprendre la vigilance</p>
                <h3>Un indicateur, pas un verdict.</h3>
                <p>La vigilance résume plusieurs signaux observés. Elle ne garantit ni l'obtention ni l'absence d'un contrat d'apprentissage.</p>
              </section>
              {index && index.publishedCount === 0 ? <section className="information-card muted-information-card"><p>Aucune vigilance détaillée n'est actuellement publiée. Ne déduisez pas une situation favorable de l'absence de publication.</p></section> : null}
            </aside>
          </div>
        </section>
      </div>
    </PublicLayout>
  );
}
