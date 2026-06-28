import React, { useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { toPng } from 'html-to-image';

import { auth, db, storage } from './firebase';
import FranceMap from './FranceMap';
import PublicVisualCard from './PublicVisualCard';

const levels = ['Vert', 'Jaune', 'Orange', 'Rouge'];

const levelLabels = {
  Vert: 'Situation normale',
  Jaune: 'Attention',
  Orange: 'Tension marquée',
  Rouge: 'Tension critique',
};

const levelAdvice = {
  Vert: 'Aucune vigilance particulière. Le marché observé ne présente pas de tension majeure.',
  Jaune: 'Surveillance recommandée. Les candidats et organismes doivent suivre l’évolution locale.',
  Orange: 'Tension significative. Il est conseillé d’anticiper les candidatures, relances et démarches auprès des employeurs.',
  Rouge: 'Tension critique. Les candidats doivent élargir fortement leur recherche et mobiliser les réseaux d’accompagnement.',
};

const levelPriority = {
  Rouge: 0,
  Orange: 1,
  Jaune: 2,
  Vert: 3,
};

function normalizeDepartmentCode(value) {
  const raw = String(value || '').trim();

  if (!raw) {
    return '';
  }

  if (raw === '2A' || raw === '2B') {
    return raw;
  }

  if (/^\d$/.test(raw)) {
    return `0${raw}`;
  }

  return raw;
}

function formatDate(value) {
  if (!value) {
    return 'Non publié';
  }

  if (value?.toDate) {
    return value.toDate().toLocaleString('fr-FR');
  }

  return String(value);
}

function sortDepartments(items) {
  return [...items].sort((a, b) => {
    return normalizeDepartmentCode(a.code).localeCompare(normalizeDepartmentCode(b.code));
  });
}

function getLevelClass(level) {
  return `level-${String(level || 'Vert').toLowerCase()}`;
}

function countByLevel(departments) {
  return departments.reduce(
    (accumulator, department) => {
      const level = department.level || 'Vert';
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

function dataUrlToBlob(dataUrl) {
  const parts = dataUrl.split(',');
  const mimeMatch = parts[0].match(/:(.*?);/);
  const mime = mimeMatch ? mimeMatch[1] : 'image/png';
  const binaryString = atob(parts[1]);
  let length = binaryString.length;
  const bytes = new Uint8Array(length);

  while (length--) {
    bytes[length] = binaryString.charCodeAt(length);
  }

  return new Blob([bytes], { type: mime });
}

function getPublicDisplayLevelFromAi(department) {
  if (!department) {
    return 'Vert';
  }

  const suggestedLevel = department.suggestedLevel || department.previousPublishedLevel || 'Vert';

  const isOneDayDegradation =
    department.changeType === 'degrade' &&
    Array.isArray(department.dataEvidence) &&
    department.dataEvidence.some((item) => String(item).includes('Offres J:'));

  const hasRepeatedSignal =
    Array.isArray(department.aggravatingFactors) &&
    department.aggravatingFactors.some((factor) => {
      const text = String(factor).toLowerCase();
      return (
        text.includes('répét') ||
        text.includes('plusieurs jours') ||
        text.includes('expir') ||
        text.includes('faible volume 30 jours') ||
        text.includes('recruteurs')
      );
    });

  if (suggestedLevel === 'Rouge' && isOneDayDegradation && !hasRepeatedSignal) {
    return 'Orange';
  }

  if (suggestedLevel === 'Orange' && isOneDayDegradation && !hasRepeatedSignal) {
    return 'Jaune';
  }

  return suggestedLevel;
}

function buildPublicReasonFromAi(department) {
  if (!department) {
    return '';
  }

  const displayLevel = getPublicDisplayLevelFromAi(department);

  if (department.publicReason) {
    if (department.suggestedLevel === 'Orange' && displayLevel === 'Jaune') {
      return `${department.publicReason} Le niveau public recommandé reste Jaune tant que le signal n’est pas confirmé sur plusieurs jours ou par d’autres indicateurs.`;
    }

    return department.publicReason;
  }

  const level = department.suggestedLevel || department.previousPublishedLevel || 'Vert';

  if (department.changeType === 'degrade') {
    return `Le département passe en vigilance ${level} en raison d’une dégradation nette du flux d’offres observé. La situation doit être vérifiée dans les prochains jours.`;
  }

  if (department.changeType === 'watch') {
    return 'Le département reste sous surveillance : les données observées montrent un signal ponctuel à confirmer avant tout changement durable de niveau.';
  }

  if (department.changeType === 'improve') {
    return 'La situation s’améliore dans les données observées, mais le suivi reste maintenu afin de confirmer la tendance.';
  }

  return 'Situation conforme au niveau publié, sans signal suffisant pour modifier la vigilance.';
}

function BulletinAdminPage() {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [dataLoading, setDataLoading] = useState(false);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const [bulletin, setBulletin] = useState({
    title: 'Bulletin national ApprentiFR',
    level: 'Vert',
    summary: '',
    status: 'draft',
    updatedAt: null,
    updatedBy: '',
  });

  const [departments, setDepartments] = useState([]);
  const [statsByCode, setStatsByCode] = useState({});
  const [sectorStats, setSectorStats] = useState([]);
  const [latestAiReport, setLatestAiReport] = useState(null);
  const [mapMode, setMapMode] = useState('published');
  const [assistantAnswer, setAssistantAnswer] = useState('');

  const [selectedDepartmentCode, setSelectedDepartmentCode] = useState('');
  const [selectedDepartmentLevel, setSelectedDepartmentLevel] = useState('Jaune');
  const [selectedDepartmentReason, setSelectedDepartmentReason] = useState('');

  const [message, setMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [savingBulletin, setSavingBulletin] = useState(false);
  const [savingDepartment, setSavingDepartment] = useState(false);

  const visualRef = useRef(null);
  const [generatingVisual, setGeneratingVisual] = useState(false);
  const [generatedVisualUrl, setGeneratedVisualUrl] = useState('');

  async function loadData() {
    setDataLoading(true);
    setErrorMessage('');

    try {
      const [bulletinSnapshot, departmentsSnapshot, statsSnapshot] = await Promise.all([
        getDoc(doc(db, 'bulletins', 'national-current')),
        getDocs(collection(db, 'departments')),
        getDocs(collection(db, 'departmentStats')),
      ]);

      if (bulletinSnapshot.exists()) {
        setBulletin((current) => ({
          ...current,
          ...bulletinSnapshot.data(),
        }));
      }

      const loadedDepartments = departmentsSnapshot.docs.map((document) => {
        const data = document.data();
        const code = normalizeDepartmentCode(data.code || document.id);

        return {
          id: document.id,
          ...data,
          code,
          name: data.name || data.nom || data.label || `Département ${code}`,
          level: data.level || 'Vert',
          reason: data.reason || '',
        };
      });

      const loadedStatsByCode = statsSnapshot.docs.reduce((accumulator, document) => {
        const data = document.data();
        const code = normalizeDepartmentCode(data.code || document.id);

        accumulator[code] = {
          id: document.id,
          ...data,
          code,
        };

        return accumulator;
      }, {});

      setDepartments(sortDepartments(loadedDepartments));
      setStatsByCode(loadedStatsByCode);

      try {
        const aiReportSnapshot = await getDocs(
          query(collection(db, 'aiReports'), orderBy('date', 'desc'), limit(1))
        );

        const loadedAiReport = aiReportSnapshot.docs[0]
          ? {
              id: aiReportSnapshot.docs[0].id,
              ...aiReportSnapshot.docs[0].data(),
            }
          : null;

        setLatestAiReport(loadedAiReport);
      } catch (error) {
        console.warn('Rapport IA non chargé :', error);
        setLatestAiReport(null);
      }

      try {
        const sectorStatsSnapshot = await getDocs(collection(db, 'departmentSectorStats'));

        const loadedSectorStats = sectorStatsSnapshot.docs.map((document) => {
          const data = document.data();

          return {
            id: document.id,
            ...data,
            departmentCode: normalizeDepartmentCode(data.departmentCode || data.code),
            sectorLabel: data.sectorLabel || data.sector || data.label || 'Secteur non renseigné',
            level: data.publicLevel || data.suggestedLevel || data.level || 'Vert',
          };
        });

        setSectorStats(loadedSectorStats);
      } catch (error) {
        console.warn('Données sectorielles non chargées :', error);
        setSectorStats([]);
      }
    } catch (error) {
      console.error('Erreur chargement page bulletin :', error);
      setErrorMessage('Impossible de charger les données principales du bulletin.');
    } finally {
      setDataLoading(false);
    }
  }

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      setProfile(null);
      setErrorMessage('');

      if (!currentUser) {
        setAuthLoading(false);
        return;
      }

      try {
        const profileSnapshot = await getDoc(doc(db, 'users', currentUser.uid));
        const loadedProfile = profileSnapshot.exists() ? profileSnapshot.data() : null;

        setProfile(loadedProfile);

        if (loadedProfile?.role === 'admin') {
          await loadData();
        }
      } catch (error) {
        console.error('Erreur profil admin bulletin :', error);
        setErrorMessage('Impossible de vérifier les droits administrateur.');
      } finally {
        setAuthLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

  const computed = useMemo(() => {
    const counts = countByLevel(departments);

    const vigilanceDepartments = departments.filter((department) => {
      return department.level && department.level !== 'Vert';
    });

    const criticalDepartments = vigilanceDepartments.filter((department) => {
      return department.level === 'Rouge' || department.level === 'Orange';
    });

    const grouped = {
      Rouge: vigilanceDepartments.filter((department) => department.level === 'Rouge'),
      Orange: vigilanceDepartments.filter((department) => department.level === 'Orange'),
      Jaune: vigilanceDepartments.filter((department) => department.level === 'Jaune'),
    };

    return {
      counts,
      vigilanceDepartments,
      criticalDepartments,
      grouped,
    };
  }, [departments]);

  const aiSuggestedDepartments = useMemo(() => {
    const aiDepartments = Array.isArray(latestAiReport?.allDepartments)
      ? latestAiReport.allDepartments
      : [];

    if (aiDepartments.length === 0) {
      return [];
    }

    const aiByCode = aiDepartments.reduce((accumulator, department) => {
      accumulator[normalizeDepartmentCode(department.code)] = department;
      return accumulator;
    }, {});

    return departments.map((department) => {
      const suggestion = aiByCode[normalizeDepartmentCode(department.code)];

      if (!suggestion) {
        return department;
      }

      const displayLevel = getPublicDisplayLevelFromAi(suggestion);

      return {
        ...department,
        level: displayLevel || department.level || 'Vert',
        reason:
          buildPublicReasonFromAi(suggestion) ||
          department.reason ||
          'Suggestion IA sans motif détaillé.',
        aiSuggestedLevel: suggestion.suggestedLevel || 'Non renseigné',
        aiConfidence: suggestion.confidence || 'unknown',
        aiEvolution: suggestion.evolution || 'unknown',
        aiPreviousLevel: suggestion.previousPublishedLevel || department.level || 'Vert',
      };
    });
  }, [departments, latestAiReport]);

  const mapDepartments =
    mapMode === 'ai' && aiSuggestedDepartments.length > 0
      ? aiSuggestedDepartments
      : departments;

  const mapCounts = useMemo(() => countByLevel(mapDepartments), [mapDepartments]);

  const selectedDepartment = useMemo(() => {
    return (
      departments.find((item) => {
        return normalizeDepartmentCode(item.code) === normalizeDepartmentCode(selectedDepartmentCode);
      }) || null
    );
  }, [departments, selectedDepartmentCode]);

  const selectedMapDepartment = useMemo(() => {
    return (
      mapDepartments.find((item) => {
        return normalizeDepartmentCode(item.code) === normalizeDepartmentCode(selectedDepartmentCode);
      }) ||
      selectedDepartment ||
      null
    );
  }, [mapDepartments, selectedDepartment, selectedDepartmentCode]);

  const selectedDepartmentSectorRows = useMemo(() => {
    if (!selectedDepartmentCode) {
      return [];
    }

    return sectorStats
      .filter((item) => {
        return normalizeDepartmentCode(item.departmentCode || item.code) === normalizeDepartmentCode(selectedDepartmentCode);
      })
      .map((item) => ({
        id: item.id,
        sectorLabel: item.sectorLabel || item.sector || item.label || 'Secteur non renseigné',
        level: item.publicLevel || item.suggestedLevel || item.level || 'Vert',
        reason:
          item.publicReason ||
          item.reason ||
          'Aucun commentaire sectoriel public renseigné.',
        jobsCount:
          item.jobsCount30Days ??
          item.jobsCount ??
          item.dailyJobsCount ??
          0,
        openingCount:
          item.openingCount30Days ??
          item.openingCount ??
          item.dailyOpeningCount ??
          0,
        confidence: item.confidence || 'non renseignée',
      }))
      .sort((a, b) => {
        const levelA = levelPriority[a.level] ?? 9;
        const levelB = levelPriority[b.level] ?? 9;

        if (levelA !== levelB) {
          return levelA - levelB;
        }

        return a.sectorLabel.localeCompare(b.sectorLabel);
      });
  }, [sectorStats, selectedDepartmentCode]);

  const aiSignals = Array.isArray(latestAiReport?.importantSignals)
    ? latestAiReport.importantSignals
    : [];

  const aiDepartmentsToReview = useMemo(() => {
    const aiDepartments = Array.isArray(latestAiReport?.allDepartments)
      ? latestAiReport.allDepartments
      : [];

    return aiDepartments
      .filter((department) => {
        const hasLevelChange =
          department.suggestedLevel &&
          department.suggestedLevel !== department.previousPublishedLevel;
        const isWatched = department.changeType && department.changeType !== 'maintain';
        const hasStrongConfidence = department.confidence === 'high';
        const hasAggravatingFactors =
          Array.isArray(department.aggravatingFactors) &&
          department.aggravatingFactors.length > 0;

        return hasLevelChange || isWatched || hasStrongConfidence || hasAggravatingFactors;
      })
      .sort((a, b) => {
        const changePriority = {
          degrade: 0,
          watch: 1,
          improve: 2,
          maintain: 3,
        };

        const changeA = changePriority[a.changeType] ?? 9;
        const changeB = changePriority[b.changeType] ?? 9;

        if (changeA !== changeB) {
          return changeA - changeB;
        }

        const levelA = levelPriority[a.suggestedLevel] ?? 9;
        const levelB = levelPriority[b.suggestedLevel] ?? 9;

        if (levelA !== levelB) {
          return levelA - levelB;
        }

        return normalizeDepartmentCode(a.code).localeCompare(normalizeDepartmentCode(b.code));
      })
      .slice(0, 24);
  }, [latestAiReport]);

  function updateBulletin(field, value) {
    setBulletin((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function handleSelectDepartment(code) {
    const normalizedCode = normalizeDepartmentCode(code);
    const department = departments.find((item) => {
      return normalizeDepartmentCode(item.code) === normalizedCode;
    });

    setSelectedDepartmentCode(normalizedCode);

    if (department) {
      setSelectedDepartmentLevel(department.level || 'Jaune');
      setSelectedDepartmentReason(department.reason || '');
    }
  }

  function applyAiBulletinProposal() {
    const proposal = latestAiReport?.bulletinProposal;

    if (!proposal) {
      setErrorMessage('Aucune proposition IA disponible.');
      return;
    }

    setBulletin((current) => ({
      ...current,
      title: proposal.title || current.title,
      level: proposal.level || current.level,
      summary: proposal.summary || current.summary,
      status: 'draft',
    }));

    setMessage('Proposition IA reprise dans le bulletin en brouillon.');
  }

  function applyAiDepartmentReason(department) {
    if (!department?.code) {
      return;
    }

    handleSelectDepartment(department.code);
    setSelectedDepartmentLevel(getPublicDisplayLevelFromAi(department));
    setSelectedDepartmentReason(buildPublicReasonFromAi(department));
    setMessage(`Proposition IA reprise pour ${department.name} (${department.code}).`);
  }

  function handleAssistantPreset(type) {
    if (!latestAiReport) {
      setAssistantAnswer('Aucun rapport IA disponible pour le moment.');
      return;
    }

    if (type === 'national') {
      setAssistantAnswer(
        latestAiReport.nationalAssessment?.summary ||
          'Le rapport IA ne contient pas encore de synthèse nationale.'
      );
      return;
    }

    if (type === 'signals') {
      const text = aiSignals
        .slice(0, 6)
        .map((signal) => `• ${signal.title} : ${signal.explanation}`)
        .join('\n');

      setAssistantAnswer(text || 'Aucun signal important remonté par l’IA.');
      return;
    }

    if (type === 'differences') {
      const aiDepartments = Array.isArray(latestAiReport.allDepartments)
        ? latestAiReport.allDepartments
        : [];

      const publishedByCode = departments.reduce((accumulator, department) => {
        accumulator[normalizeDepartmentCode(department.code)] = department;
        return accumulator;
      }, {});

      const differences = aiDepartments.filter((department) => {
        const published = publishedByCode[normalizeDepartmentCode(department.code)];
        return published && published.level !== department.suggestedLevel;
      });

      const text = differences
        .slice(0, 12)
        .map((department) => {
          const published = publishedByCode[normalizeDepartmentCode(department.code)];
          return `• ${department.name} (${department.code}) : publié ${published.level || 'Vert'} → suggéré ${department.suggestedLevel}. ${department.shortReason || ''}`;
        })
        .join('\n');

      setAssistantAnswer(text || 'Aucune différence majeure entre la carte publiée et la suggestion IA.');
      return;
    }

    if (type === 'bulletin') {
      const proposal = latestAiReport.bulletinProposal;

      if (!proposal) {
        setAssistantAnswer('Aucune proposition de bulletin disponible.');
        return;
      }

      setAssistantAnswer(
        `${proposal.title}\n\nNiveau proposé : ${proposal.level}\n\n${proposal.summary}\n\nConseil candidats : ${proposal.adviceCandidates || 'Non renseigné'}\n\nConseil CFA : ${proposal.adviceCfa || 'Non renseigné'}`
      );
    }
  }

  async function handleGeneratePublicVisual() {
    if (!visualRef.current) {
      setErrorMessage('Impossible de générer le visuel.');
      return;
    }

    if (!selectedDepartment) {
      setErrorMessage('Sélectionne un département avant de générer le visuel.');
      return;
    }

    try {
      setGeneratingVisual(true);
      setErrorMessage('');
      setMessage('');
      setGeneratedVisualUrl('');

      const dataUrl = await toPng(visualRef.current, {
        cacheBust: true,
        pixelRatio: 2,
        backgroundColor: '#ffffff',
      });

      const blob = dataUrlToBlob(dataUrl);
      const safeDate = bulletin?.date || new Date().toISOString().slice(0, 10);
      const safeCode = selectedDepartment.code || 'xx';

      const fileRef = storageRef(
        storage,
        `public-visuals/${safeDate}/department-${safeCode}.png`
      );

      await uploadBytes(fileRef, blob, {
        contentType: 'image/png',
      });

      const downloadUrl = await getDownloadURL(fileRef);

      setGeneratedVisualUrl(downloadUrl);
      setMessage('Visuel public généré avec succès.');
    } catch (error) {
      console.error('Erreur génération visuel public :', error);
      setErrorMessage('La génération du visuel a échoué.');
    } finally {
      setGeneratingVisual(false);
    }
  }

  async function handleLogin(event) {
    event.preventDefault();
    setAuthLoading(true);
    setErrorMessage('');

    try {
      await signInWithEmailAndPassword(auth, email, password);
      setPassword('');
    } catch (error) {
      console.error('Erreur connexion bulletin :', error);
      setErrorMessage('Connexion impossible.');
      setAuthLoading(false);
    }
  }

  async function handleLogout() {
    await signOut(auth);
  }

  async function saveBulletin(status) {
    setSavingBulletin(true);
    setMessage('');
    setErrorMessage('');

    try {
      const cleanBulletin = {
        title: String(bulletin.title || '').trim(),
        level: String(bulletin.level || 'Vert').trim(),
        summary: String(bulletin.summary || '').trim(),
        status,
        updatedAt: serverTimestamp(),
        updatedBy: user?.email || '',
      };

      if (!cleanBulletin.title || !cleanBulletin.summary) {
        setErrorMessage('Le titre et le résumé sont obligatoires.');
        return;
      }

      await setDoc(doc(db, 'bulletins', 'national-current'), cleanBulletin, {
        merge: true,
      });

      setBulletin((current) => ({
        ...current,
        ...cleanBulletin,
        updatedAt: new Date().toISOString(),
      }));

      setMessage(status === 'published' ? 'Bulletin publié.' : 'Brouillon enregistré.');
    } catch (error) {
      console.error('Erreur sauvegarde bulletin :', error);
      setErrorMessage('Impossible d’enregistrer le bulletin.');
    } finally {
      setSavingBulletin(false);
    }
  }

  async function saveSelectedDepartment() {
    const department = departments.find((item) => {
      return normalizeDepartmentCode(item.code) === normalizeDepartmentCode(selectedDepartmentCode);
    });

    if (!department) {
      setErrorMessage('Sélectionne un département.');
      return;
    }

    setSavingDepartment(true);
    setMessage('');
    setErrorMessage('');

    try {
      const cleanDepartment = {
        code: department.code,
        name: department.name,
        level: selectedDepartmentLevel,
        reason: String(selectedDepartmentReason || '').trim(),
        updatedAt: serverTimestamp(),
      };

      if (!cleanDepartment.reason) {
        setErrorMessage('Le motif de vigilance est obligatoire.');
        return;
      }

      await setDoc(doc(db, 'departments', cleanDepartment.code), cleanDepartment, {
        merge: true,
      });

      setDepartments((currentDepartments) =>
        currentDepartments.map((item) =>
          normalizeDepartmentCode(item.code) === normalizeDepartmentCode(cleanDepartment.code)
            ? {
                ...item,
                ...cleanDepartment,
              }
            : item
        )
      );

      setMessage(`${cleanDepartment.name} mis à jour.`);
    } catch (error) {
      console.error('Erreur sauvegarde département :', error);
      setErrorMessage('Impossible d’enregistrer le département.');
    } finally {
      setSavingDepartment(false);
    }
  }

  if (authLoading) {
    return (
      <main className="bulletin-loading">
        <p>Chargement du pilotage bulletin...</p>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="bulletin-login-page">
        <section className="admin-login-card">
          <p className="admin-kicker">Accès réservé</p>
          <h1>Pilotage des bulletins</h1>
          <p>Connecte-toi pour rédiger et publier le bulletin national.</p>

          <form onSubmit={handleLogin} className="admin-form">
            <label htmlFor="bulletin-email">Email</label>
            <input
              id="bulletin-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              required
            />

            <label htmlFor="bulletin-password">Mot de passe</label>
            <input
              id="bulletin-password"
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
      <main className="bulletin-login-page">
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
    <main className="bulletin-shell">
      <aside className="bulletin-sidebar">
        <div className="bulletin-brand">
          <span>ApprentiFR</span>
          <strong>Bulletins</strong>
        </div>

        <nav className="bulletin-nav">
          <a className="active" href="/pilotage-bulletins">Bulletin national</a>
          <a href="/pilotage-observatoire">Observatoire</a>
          <a href="/">Site public</a>
        </nav>

        <div className={`bulletin-status-card ${getLevelClass(bulletin.level)}`}>
          <span>Niveau national</span>
          <strong>{bulletin.level}</strong>
          <small>{levelLabels[bulletin.level] || 'Non renseigné'}</small>
        </div>

        <button className="bulletin-logout" type="button" onClick={handleLogout}>
          Déconnexion
        </button>
      </aside>

      <section className="bulletin-workspace">
        <header className="bulletin-topbar">
          <div>
            <p className="admin-kicker">Console de publication</p>
            <h1>Bulletin national</h1>
          </div>

          <div className="bulletin-topbar-meta">
            <span>Statut : {bulletin.status === 'published' ? 'Publié' : 'Brouillon'}</span>
            <span>Dernière mise à jour : {formatDate(bulletin.updatedAt)}</span>
          </div>
        </header>

        {dataLoading && <p>Chargement des données...</p>}
        {message && <p className="admin-form-success">{message}</p>}
        {errorMessage && <p className="admin-error">{errorMessage}</p>}

        <section className="bulletin-kpi-grid">
          <article className="bulletin-kpi">
            <span>Départements verts</span>
            <strong>{computed.counts.Vert}</strong>
          </article>
          <article className="bulletin-kpi yellow">
            <span>Vigilance jaune</span>
            <strong>{computed.counts.Jaune}</strong>
          </article>
          <article className="bulletin-kpi orange">
            <span>Vigilance orange</span>
            <strong>{computed.counts.Orange}</strong>
          </article>
          <article className="bulletin-kpi red">
            <span>Vigilance rouge</span>
            <strong>{computed.counts.Rouge}</strong>
          </article>
        </section>

        <section className="bulletin-intelligence-layout">
          <article className="bulletin-map-panel">
            <div className="panel-heading">
              <p className="admin-kicker">Carte de décision</p>
              <h2>Carte France</h2>
            </div>

            <div className="map-mode-switch">
              <button
                type="button"
                className={mapMode === 'published' ? 'active' : ''}
                onClick={() => setMapMode('published')}
              >
                Publiée
              </button>
              <button
                type="button"
                className={mapMode === 'ai' ? 'active' : ''}
                onClick={() => setMapMode('ai')}
                disabled={!latestAiReport}
              >
                Suggérée IA
              </button>
            </div>

            <div className="map-count-row">
              <span>Vert : {mapCounts.Vert}</span>
              <span>Jaune : {mapCounts.Jaune}</span>
              <span>Orange : {mapCounts.Orange}</span>
              <span>Rouge : {mapCounts.Rouge}</span>
            </div>

            <FranceMap
              departments={mapDepartments}
              title={mapMode === 'ai' ? 'Suggestion IA' : 'Carte publiée'}
              emptyTitle="Sélectionne un département"
              emptyText="Clique sur un département pour consulter le niveau affiché sur cette carte."
              onSelectDepartment={handleSelectDepartment}
            />

            <div className="department-bulletin-panel">
              <div className="department-bulletin-header">
                <p className="admin-kicker">Bulletin départemental</p>
                <h3>
                  {selectedMapDepartment
                    ? `${selectedMapDepartment.name} (${selectedMapDepartment.code})`
                    : 'Aucun département sélectionné'}
                </h3>
              </div>

              {selectedMapDepartment ? (
                <>
                  <div className={`department-global-card ${getLevelClass(selectedMapDepartment.level)}`}>
                    <div>
                      <span>Vigilance globale du département</span>
                      <strong>{selectedMapDepartment.level || 'Vert'}</strong>
                    </div>

                    <p>
                      {selectedMapDepartment.reason ||
                        'Aucun motif public renseigné pour ce département.'}
                    </p>

                    {mapMode === 'ai' && selectedMapDepartment.aiSuggestedLevel ? (
                      <small>
                        IA brute : {selectedMapDepartment.aiSuggestedLevel} · confiance : {selectedMapDepartment.aiConfidence}
                      </small>
                    ) : null}
                  </div>

                  <div className="department-sector-section">
                    <div className="department-sector-title-row">
                      <h4>Situation par secteur dans ce département</h4>
                      <span>{selectedDepartmentSectorRows.length} secteur(s)</span>
                    </div>

                    {selectedDepartmentSectorRows.length > 0 ? (
                      <div className="department-sector-grid">
                        {selectedDepartmentSectorRows.map((sector) => (
                          <article className="department-sector-card" key={sector.id || sector.sectorLabel}>
                            <div className="department-sector-card-header">
                              <span className={`sector-level-pill ${getLevelClass(sector.level)}`}>
                                {sector.level}
                              </span>
                              <strong>{sector.sectorLabel}</strong>
                            </div>

                            <p>{sector.reason}</p>

                            <small>
                              {Number(sector.jobsCount || 0).toLocaleString('fr-FR')} offres ·{' '}
                              {Number(sector.openingCount || 0).toLocaleString('fr-FR')} postes ·{' '}
                              confiance : {sector.confidence}
                            </small>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <p className="empty-state">
                        Aucune donnée sectorielle disponible pour ce département.
                      </p>
                    )}
                  </div>
                </>
              ) : (
                <p className="empty-state">
                  Clique sur un département pour afficher sa vigilance globale et le détail par secteur.
                </p>
              )}
            </div>
          </article>

          <article className="bulletin-ai-panel">
            <div className="panel-heading">
              <p className="admin-kicker">Assistant</p>
              <h2>Rapport IA & aide bulletin</h2>
            </div>

            {latestAiReport ? (
              <>
                <div className={`ai-report-summary ${getLevelClass(latestAiReport.nationalAssessment?.suggestedLevel || latestAiReport.bulletinProposal?.level)}`}>
                  <span>Rapport du {latestAiReport.date}</span>
                  <strong>
                    Niveau suggéré : {latestAiReport.nationalAssessment?.suggestedLevel || latestAiReport.bulletinProposal?.level || 'Non renseigné'}
                  </strong>
                  <p>{latestAiReport.nationalAssessment?.summary || 'Aucune synthèse nationale disponible.'}</p>
                  <small>
                    Confiance : {latestAiReport.nationalAssessment?.confidence || 'non renseignée'}
                  </small>
                </div>

                <div className="assistant-actions">
                  <button type="button" onClick={() => handleAssistantPreset('national')}>
                    Résumer la situation
                  </button>
                  <button type="button" onClick={() => handleAssistantPreset('signals')}>
                    Signaux importants
                  </button>
                  <button type="button" onClick={() => handleAssistantPreset('differences')}>
                    Publié vs IA
                  </button>
                  <button type="button" onClick={() => handleAssistantPreset('bulletin')}>
                    Proposition bulletin
                  </button>
                </div>

                <div className="assistant-answer">
                  <pre>
                    {assistantAnswer || 'Choisis une action pour interroger le rapport IA du jour.'}
                  </pre>
                </div>

                <button
                  type="button"
                  className="ai-apply-button"
                  onClick={applyAiBulletinProposal}
                >
                  Reprendre la proposition IA dans le bulletin
                </button>

                <div className="ai-signal-list">
                  <strong>Départements à examiner</strong>

                  {aiDepartmentsToReview.length > 0 ? (
                    aiDepartmentsToReview.map((department) => (
                      <article className="ai-signal-card" key={department.code}>
                        <span>{department.changeType || 'watch'}</span>
                        <h3>
                          {department.name} ({department.code})
                        </h3>
                        <p>
                          Publié : {department.previousPublishedLevel || 'Non renseigné'} · IA : {department.suggestedLevel || 'Non renseigné'} · public conseillé : {getPublicDisplayLevelFromAi(department)}
                        </p>
                        <p>{department.shortReason || department.publicReason || 'Aucun commentaire IA.'}</p>
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => applyAiDepartmentReason(department)}
                        >
                          Reprendre pour ce département
                        </button>
                      </article>
                    ))
                  ) : (
                    <p>Aucun département prioritaire à examiner.</p>
                  )}
                </div>
              </>
            ) : (
              <div className="ai-report-empty">
                <strong>Aucun rapport IA disponible</strong>
                <p>
                  Le prochain rapport apparaîtra ici après l’exécution de la fonction IA quotidienne.
                </p>
              </div>
            )}
          </article>
        </section>

        <section className="bulletin-layout">
          <article className="bulletin-editor-panel">
            <div className="panel-heading">
              <p className="admin-kicker">Rédaction</p>
              <h2>Éditer le bulletin</h2>
            </div>

            <div className="bulletin-form-grid">
              <div>
                <label htmlFor="bulletin-title">Titre du bulletin</label>
                <input
                  id="bulletin-title"
                  type="text"
                  value={bulletin.title || ''}
                  onChange={(event) => updateBulletin('title', event.target.value)}
                />
              </div>

              <div>
                <label htmlFor="bulletin-level">Niveau national</label>
                <select
                  id="bulletin-level"
                  value={bulletin.level || 'Vert'}
                  onChange={(event) => updateBulletin('level', event.target.value)}
                >
                  {levels.map((level) => (
                    <option key={level} value={level}>
                      {level} - {levelLabels[level]}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <label htmlFor="bulletin-summary">Résumé public</label>
            <textarea
              id="bulletin-summary"
              rows="9"
              value={bulletin.summary || ''}
              onChange={(event) => updateBulletin('summary', event.target.value)}
              placeholder="Résumé clair de la situation nationale, des tensions observées et des conseils à appliquer."
            />

            <div className="bulletin-actions">
              <button
                type="button"
                className="secondary"
                onClick={() => saveBulletin('draft')}
                disabled={savingBulletin}
              >
                Enregistrer brouillon
              </button>

              <button
                type="button"
                onClick={() => saveBulletin('published')}
                disabled={savingBulletin}
              >
                {savingBulletin ? 'Publication...' : 'Publier le bulletin'}
              </button>
            </div>
          </article>

          <article className="bulletin-preview-panel">
            <div className="panel-heading">
              <p className="admin-kicker">Prévisualisation</p>
              <h2>Rendu public</h2>
            </div>

            <div className={`public-bulletin-preview ${getLevelClass(bulletin.level)}`}>
              <div className="preview-level-row">
                <span>{bulletin.level}</span>
                <strong>{levelLabels[bulletin.level]}</strong>
              </div>

              <h3>{bulletin.title || 'Bulletin national ApprentiFR'}</h3>

              <p className="preview-summary">
                {bulletin.summary || 'Aucun résumé rédigé pour le moment.'}
              </p>

              <div className="preview-advice">
                <strong>Conseil de comportement</strong>
                <p>{levelAdvice[bulletin.level]}</p>
              </div>

              <div className="preview-zones">
                <strong>Départements en vigilance</strong>

                {computed.vigilanceDepartments.length > 0 ? (
                  <p>
                    {computed.vigilanceDepartments
                      .slice(0, 18)
                      .map((department) => `${department.name} (${department.code})`)
                      .join(', ')}
                    {computed.vigilanceDepartments.length > 18 ? '…' : ''}
                  </p>
                ) : (
                  <p>Aucun département en vigilance particulière.</p>
                )}
              </div>
            </div>
          </article>
        </section>

        <section className="visual-generator-panel">
          <h3>Communication publique</h3>
          <p>
            Génère un visuel public carré à partir du département sélectionné et du commentaire public validé.
          </p>

          <div className="visual-generator-actions">
            <button
              type="button"
              onClick={handleGeneratePublicVisual}
              disabled={generatingVisual || !selectedDepartment}
            >
              {generatingVisual ? 'Génération en cours...' : 'Générer le visuel public'}
            </button>

            {generatedVisualUrl ? (
              <a
                href={generatedVisualUrl}
                target="_blank"
                rel="noreferrer"
                className="secondary"
              >
                Ouvrir le visuel
              </a>
            ) : null}
          </div>

          <div className="visual-preview-wrap">
            <div ref={visualRef}>
              <PublicVisualCard
                mode="department"
                bulletinDate={bulletin?.date || formatDate(bulletin?.updatedAt)}
                department={{
                  ...(selectedDepartment || {}),
                  level: selectedDepartmentLevel || selectedDepartment?.level || 'Vert',
                  reason: selectedDepartmentReason || selectedDepartment?.reason || bulletin?.summary,
                }}
                bulletinTitle={bulletin?.title}
                nationalSummary={bulletin?.summary}
              />
            </div>
          </div>
        </section>

        <section className="bulletin-zones-layout">
          <article className="zone-editor-panel">
            <div className="panel-heading">
              <p className="admin-kicker">Zones</p>
              <h2>Modifier une vigilance locale</h2>
            </div>

            <div className="zone-form-grid">
              <div>
                <label htmlFor="zone-department">Département</label>
                <select
                  id="zone-department"
                  value={selectedDepartmentCode}
                  onChange={(event) => handleSelectDepartment(event.target.value)}
                >
                  <option value="">Sélectionner un département</option>
                  {departments.map((department) => (
                    <option key={department.code} value={department.code}>
                      {department.name} ({department.code})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="zone-level">Niveau</label>
                <select
                  id="zone-level"
                  value={selectedDepartmentLevel}
                  onChange={(event) => setSelectedDepartmentLevel(event.target.value)}
                >
                  {levels.map((level) => (
                    <option key={level} value={level}>
                      {level}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <label htmlFor="zone-reason">Motif public</label>
            <textarea
              id="zone-reason"
              rows="5"
              value={selectedDepartmentReason}
              onChange={(event) => setSelectedDepartmentReason(event.target.value)}
              placeholder="Exemple : faible volume d’offres observées sur 30 jours et tension persistante sur certains secteurs."
            />

            <button
              type="button"
              onClick={saveSelectedDepartment}
              disabled={savingDepartment}
            >
              {savingDepartment ? 'Enregistrement...' : 'Enregistrer la zone'}
            </button>
          </article>

          <article className="zones-summary-panel">
            <div className="panel-heading">
              <p className="admin-kicker">Synthèse</p>
              <h2>Zones actuellement surveillées</h2>
            </div>

            <div className="zones-columns">
              {['Rouge', 'Orange', 'Jaune'].map((level) => (
                <div className="zones-column" key={level}>
                  <h3 className={getLevelClass(level)}>{level}</h3>

                  {computed.grouped[level].length > 0 ? (
                    computed.grouped[level].map((department) => {
                      const stats = statsByCode[normalizeDepartmentCode(department.code)];

                      return (
                        <article className="zone-mini-card" key={department.code}>
                          <strong>
                            {department.name} ({department.code})
                          </strong>
                          <p>{department.reason || 'Motif non renseigné.'}</p>
                          <small>
                            {Number(stats?.jobsCount || 0).toLocaleString('fr-FR')} offres sur 30 jours ·{' '}
                            {Number(stats?.openingCount || 0).toLocaleString('fr-FR')} postes
                          </small>
                        </article>
                      );
                    })
                  ) : (
                    <p className="empty-state">Aucun département.</p>
                  )}
                </div>
              ))}
            </div>
          </article>
        </section>
      </section>
    </main>
  );
}

export default BulletinAdminPage;
