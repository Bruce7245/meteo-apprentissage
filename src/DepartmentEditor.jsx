import React, { useEffect, useMemo, useState } from 'react';
import {
  collection,
  doc,
  getDocs,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import { db } from './firebase';

const levels = ['Tous', 'Rouge', 'Orange', 'Jaune', 'Vert'];

function sortDepartments(items) {
  return [...items].sort((a, b) => String(a.code).localeCompare(String(b.code)));
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString('fr-FR');
}

function DepartmentEditor() {
  const [departments, setDepartments] = useState([]);
  const [statsByCode, setStatsByCode] = useState({});
  const [loading, setLoading] = useState(true);
  const [savingCode, setSavingCode] = useState('');
  const [selectedLevel, setSelectedLevel] = useState('Tous');
  const [search, setSearch] = useState('');
  const [message, setMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  async function loadDepartmentsAndStats() {
    setLoading(true);
    setErrorMessage('');

    try {
      const [departmentsSnapshot, statsSnapshot] = await Promise.all([
        getDocs(collection(db, 'departments')),
        getDocs(collection(db, 'departmentStats')),
      ]);

      const loadedDepartments = departmentsSnapshot.docs.map((document) => ({
        id: document.id,
        ...document.data(),
      }));

      const loadedStatsByCode = statsSnapshot.docs.reduce((accumulator, document) => {
        accumulator[document.id] = {
          id: document.id,
          ...document.data(),
        };
        return accumulator;
      }, {});

      setDepartments(sortDepartments(loadedDepartments));
      setStatsByCode(loadedStatsByCode);
    } catch (error) {
      console.error('Erreur chargement départements/stats admin :', error);
      setErrorMessage('Impossible de charger les départements ou les statistiques API.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDepartmentsAndStats();
  }, []);

  const counts = useMemo(() => {
    return departments.reduce(
      (accumulator, department) => {
        const level = department.level || 'Vert';
        accumulator.Tous += 1;
        accumulator[level] = (accumulator[level] || 0) + 1;
        return accumulator;
      },
      {
        Tous: 0,
        Rouge: 0,
        Orange: 0,
        Jaune: 0,
        Vert: 0,
      }
    );
  }, [departments]);

  const filteredDepartments = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return departments.filter((department) => {
      const matchesLevel =
        selectedLevel === 'Tous' || department.level === selectedLevel;

      const matchesSearch =
        normalizedSearch.length === 0 ||
        String(department.name).toLowerCase().includes(normalizedSearch) ||
        String(department.code).toLowerCase().includes(normalizedSearch);

      return matchesLevel && matchesSearch;
    });
  }, [departments, selectedLevel, search]);

  function updateDepartment(code, field, value) {
    setDepartments((currentDepartments) =>
      currentDepartments.map((department) =>
        department.code === code
          ? {
              ...department,
              [field]: value,
            }
          : department
      )
    );
  }

  async function saveDepartment(department) {
    setSavingCode(department.code);
    setMessage('');
    setErrorMessage('');

    try {
      const cleanDepartment = {
        name: String(department.name || '').trim(),
        code: String(department.code || '').trim(),
        level: String(department.level || 'Vert').trim(),
        reason: String(department.reason || '').trim(),
        updatedAt: serverTimestamp(),
      };

      if (!cleanDepartment.name || !cleanDepartment.code || !cleanDepartment.reason) {
        setErrorMessage('Le nom, le code et le motif sont obligatoires.');
        return;
      }

      await setDoc(
        doc(db, 'departments', cleanDepartment.code),
        cleanDepartment,
        { merge: true }
      );

      setMessage(`Département ${cleanDepartment.name} mis à jour.`);
      await loadDepartmentsAndStats();
    } catch (error) {
      console.error('Erreur sauvegarde département :', error);
      setErrorMessage('Impossible d’enregistrer le département.');
    } finally {
      setSavingCode('');
    }
  }

  return (
    <section className="department-editor">
      <div className="admin-section-heading">
        <p className="admin-kicker">Pilotage territorial</p>
        <h2>Départements en vigilance</h2>
        <p>
          Modifie le niveau de vigilance en t’appuyant sur les statistiques issues de l’API.
        </p>
      </div>

      <div className="department-toolbar">
        <div className="department-filter-buttons">
          {levels.map((level) => (
            <button
              key={level}
              type="button"
              className={selectedLevel === level ? 'active' : ''}
              onClick={() => setSelectedLevel(level)}
            >
              {level} ({counts[level] || 0})
            </button>
          ))}
        </div>

        <input
          type="search"
          placeholder="Rechercher un département ou un code"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>

      {loading && <p>Chargement des départements...</p>}
      {message && <p className="admin-form-success">{message}</p>}
      {errorMessage && <p className="admin-error">{errorMessage}</p>}

      <div className="department-editor-list">
        {filteredDepartments.length > 0 ? (
          filteredDepartments.map((department) => {
            const stats = statsByCode[department.code];

            return (
              <article className="department-editor-item" key={department.code}>
                <div className="department-stats-summary">
                  <div>
                    <span>Offres API</span>
                    <strong>{formatNumber(stats?.jobsCount)}</strong>
                  </div>
                  <div>
                    <span>Postes</span>
                    <strong>{formatNumber(stats?.openingCount)}</strong>
                  </div>
                  <div>
                    <span>Recruteurs</span>
                    <strong>{formatNumber(stats?.recruitersCount)}</strong>
                  </div>
                </div>

                <div className="department-editor-grid">
                  <div>
                    <label htmlFor={`department-name-${department.code}`}>Département</label>
                    <input
                      id={`department-name-${department.code}`}
                      type="text"
                      value={department.name || ''}
                      onChange={(event) =>
                        updateDepartment(department.code, 'name', event.target.value)
                      }
                    />
                  </div>

                  <div>
                    <label htmlFor={`department-code-${department.code}`}>Code</label>
                    <input
                      id={`department-code-${department.code}`}
                      type="text"
                      value={department.code || ''}
                      onChange={(event) =>
                        updateDepartment(department.code, 'code', event.target.value)
                      }
                    />
                  </div>

                  <div>
                    <label htmlFor={`department-level-${department.code}`}>Vigilance</label>
                    <select
                      id={`department-level-${department.code}`}
                      value={department.level || 'Vert'}
                      onChange={(event) =>
                        updateDepartment(department.code, 'level', event.target.value)
                      }
                    >
                      <option value="Vert">Vert</option>
                      <option value="Jaune">Jaune</option>
                      <option value="Orange">Orange</option>
                      <option value="Rouge">Rouge</option>
                    </select>
                  </div>
                </div>

                {stats?.topRomeCodes?.length > 0 && (
                  <div className="rome-list">
                    <strong>ROME les plus présents :</strong>
                    <span>
                      {stats.topRomeCodes
                        .slice(0, 5)
                        .map((item) => `${item.code} (${item.count})`)
                        .join(', ')}
                    </span>
                  </div>
                )}

                <label htmlFor={`department-reason-${department.code}`}>Motif public</label>
                <textarea
                  id={`department-reason-${department.code}`}
                  value={department.reason || ''}
                  onChange={(event) =>
                    updateDepartment(department.code, 'reason', event.target.value)
                  }
                  rows="3"
                />

                <button
                  type="button"
                  onClick={() => saveDepartment(department)}
                  disabled={savingCode === department.code}
                >
                  {savingCode === department.code
                    ? 'Enregistrement...'
                    : 'Enregistrer ce département'}
                </button>
              </article>
            );
          })
        ) : (
          <p className="empty-state">Aucun département ne correspond au filtre.</p>
        )}
      </div>
    </section>
  );
}

export default DepartmentEditor;
