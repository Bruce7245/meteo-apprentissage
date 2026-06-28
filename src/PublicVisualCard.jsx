import React from 'react';

const levelLabels = {
  Vert: 'Situation favorable',
  Jaune: 'Situation à surveiller',
  Orange: 'Vigilance renforcée',
  Rouge: 'Situation critique',
};

const levelMessages = {
  Vert: 'Le marché observé reste accessible. La recherche doit rester régulière et ciblée.',
  Jaune: 'Des signaux de tension apparaissent. Une veille plus active est recommandée.',
  Orange: 'Le marché est tendu. Les démarches doivent être renforcées et élargies.',
  Rouge: 'La situation est fortement dégradée. Un appui rapide du CFA ou du référent est recommandé.',
};

const levelNumbers = {
  Vert: '1',
  Jaune: '2',
  Orange: '3',
  Rouge: '4',
};

const levelScale = ['Vert', 'Jaune', 'Orange', 'Rouge'];

function normalizeLevel(level) {
  return ['Vert', 'Jaune', 'Orange', 'Rouge'].includes(level) ? level : 'Vert';
}

function getAdviceItems(level) {
  switch (level) {
    case 'Rouge':
      return [
        'Élargir fortement la zone de recherche.',
        'Contacter rapidement le CFA ou le référent.',
        'Candidater en priorité aux offres très récentes.',
      ];
    case 'Orange':
      return [
        'Élargir la recherche aux zones voisines.',
        'Relancer les entreprises déjà contactées.',
        'Multiplier les candidatures ciblées.',
      ];
    case 'Jaune':
      return [
        'Surveiller les nouvelles offres chaque jour.',
        'Relancer les contacts sans réponse.',
        'Préparer plusieurs candidatures adaptées.',
      ];
    case 'Vert':
    default:
      return [
        'Maintenir une recherche régulière.',
        'Cibler les offres cohérentes avec le projet.',
        'Suivre les nouvelles publications.',
      ];
  }
}

function getShortMessage(level, department) {
  if (department?.reason) {
    return department.reason;
  }

  return levelMessages[level] || levelMessages.Vert;
}

function getReadableDate(value) {
  if (!value) {
    return 'Date non renseignée';
  }

  if (typeof value === 'string') {
    return value;
  }

  if (typeof value?.toDate === 'function') {
    return value.toDate().toLocaleDateString('fr-FR');
  }

  return String(value);
}

export default function PublicVisualCard({
  mode = 'department',
  bulletinDate,
  department,
  bulletinTitle,
  nationalSummary,
}) {
  const level = normalizeLevel(department?.level);
  const adviceItems = getAdviceItems(level);
  const isDepartmentMode = mode === 'department';

  const title = isDepartmentMode
    ? `${department?.name || 'Département'}${department?.code ? ` (${department.code})` : ''}`
    : bulletinTitle || 'Bulletin national';

  const mainMessage = isDepartmentMode
    ? getShortMessage(level, department)
    : nationalSummary || getShortMessage(level, department);

  return (
    <div className={`public-bulletin-visual public-bulletin-${level.toLowerCase()}`}>
      <header className="public-bulletin-visual-header">
        <div className="public-bulletin-brand-block">
          <span>ApprentiFR</span>
          <strong>Vigilance apprentissage</strong>
        </div>

        <div className="public-bulletin-date-block">
          <span>Bulletin public</span>
          <strong>{getReadableDate(bulletinDate)}</strong>
        </div>
      </header>

      <main className="public-bulletin-visual-main">
        <section className="public-bulletin-title-panel">
          <p>{isDepartmentMode ? 'Département observé' : 'Territoire observé'}</p>
          <h1>{title}</h1>

          <div className="public-bulletin-scale" aria-label="Échelle de vigilance">
            {levelScale.map((item) => (
              <span
                key={item}
                className={item === level ? 'active' : ''}
              >
                {item}
              </span>
            ))}
          </div>
        </section>

        <section className="public-bulletin-level-panel">
          <span>Niveau de vigilance</span>
          <strong>{levelNumbers[level]}</strong>
          <h2>{level}</h2>
          <p>{levelLabels[level]}</p>
        </section>

        <section className="public-bulletin-message-panel">
          <span>Situation observée</span>
          <p>{mainMessage}</p>
        </section>

        <section className="public-bulletin-criteria-panel">
          <span>Lecture multi-critères</span>

          <div className="public-bulletin-criteria-grid">
            <article>
              <strong>Offres</strong>
              <p>Volume observé</p>
            </article>
            <article>
              <strong>Postes</strong>
              <p>Places disponibles</p>
            </article>
            <article>
              <strong>Secteur</strong>
              <p>Tension métier</p>
            </article>
            <article>
              <strong>Fiabilité</strong>
              <p>Donnée contrôlée</p>
            </article>
          </div>
        </section>

        <section className="public-bulletin-advice-panel">
          <span>Comportement conseillé</span>

          <div className="public-bulletin-advice-list">
            {adviceItems.map((item, index) => (
              <article key={item}>
                <strong>{index + 1}</strong>
                <p>{item}</p>
              </article>
            ))}
          </div>
        </section>
      </main>

      <footer className="public-bulletin-visual-footer">
        <span>Données issues des observations ApprentiFR</span>
        <span>Validation humaine avant publication</span>
      </footer>
    </div>
  );
}
