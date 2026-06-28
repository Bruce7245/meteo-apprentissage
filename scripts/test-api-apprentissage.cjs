const token = process.env.API_APPRENTISSAGE_TOKEN;

if (!token) {
  console.error('API_APPRENTISSAGE_TOKEN manquant.');
  process.exit(1);
}

const url = 'https://api.apprentissage.beta.gouv.fr/api/job/v1/search?departements=72';

async function tryRequest(label, headers) {
  console.log(`\nTest avec ${label}`);

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      ...headers,
    },
  });

  const text = await response.text();

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    console.log(`HTTP ${response.status}`);
    console.log(text.slice(0, 500));
    return null;
  }

  console.log(`HTTP ${response.status}`);

  if (!response.ok) {
    console.log(JSON.stringify(data, null, 2).slice(0, 1000));
    return null;
  }

  const jobs = Array.isArray(data.jobs) ? data.jobs : [];
  const recruiters = Array.isArray(data.recruiters) ? data.recruiters : [];
  const warnings = Array.isArray(data.warnings) ? data.warnings : [];

  console.log(`Offres jobs détectées : ${jobs.length}`);
  console.log(`Recruteurs potentiels détectés : ${recruiters.length}`);
  console.log(`Warnings : ${warnings.length}`);

  if (jobs.length > 0) {
    console.log('\nExemple première offre :');
    console.log({
      title: jobs[0]?.offer?.title,
      partner: jobs[0]?.identifier?.partner_label,
      workplace: jobs[0]?.workplace?.name,
      rome_codes: jobs[0]?.offer?.rome_codes,
      opening_count: jobs[0]?.offer?.opening_count,
    });
  }

  return data;
}

async function main() {
  const attempts = [
    {
      label: 'api-key',
      headers: { 'api-key': token },
    },
    {
      label: 'x-api-key',
      headers: { 'x-api-key': token },
    },
    {
      label: 'Authorization Bearer',
      headers: { Authorization: `Bearer ${token}` },
    },
  ];

  for (const attempt of attempts) {
    const result = await tryRequest(attempt.label, attempt.headers);

    if (result) {
      console.log('\nConnexion API réussie.');
      return;
    }
  }

  console.error('\nAucun format d’autorisation testé n’a fonctionné.');
  process.exit(1);
}

main().catch((error) => {
  console.error('Erreur test API :', error);
  process.exit(1);
});
