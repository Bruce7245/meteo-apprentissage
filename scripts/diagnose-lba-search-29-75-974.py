"""Diagnostic ponctuel de la route actuelle GET /job/v1/search (lecture seule).
Aucun affichage d'identifiant d'annonce, de cle, d'adresse ou de nom d'employeur.
"""
from collections import Counter
from datetime import datetime, timezone
from urllib.parse import urlencode
from zoneinfo import ZoneInfo
import json
import os
import urllib.error
import urllib.request

BASE = "https://api.apprentissage.beta.gouv.fr/api/job/v1/search"
TOKEN = os.environ.get("API_APPRENTISSAGE_TOKEN", "")
DEPS = ["29", "75", "974"]
TARGETS = ["Bretagne Alternance - Agence 6tm", "France Travail", "offres_emploi_lba"]
if not TOKEN:
    raise SystemExit("Cle manquante")

report = {
    "mode": "lecture_seule",
    "query": "GET /job/v1/search?departements=XX",
    "checked_at": datetime.now(timezone.utc).isoformat(),
    "exports_compared_from_prior_audit": {
        "29 - Bretagne Alternance": 338,
        "75 - offres_emploi_lba": 716,
        "75 - France Travail": 303,
        "974 - France Travail": 504,
    },
    "departments": []
}
for dep in DEPS:
    url = BASE + "?" + urlencode({"departements": dep})
    request = urllib.request.Request(url, headers={
        "Authorization": "Bearer " + TOKEN,
        "Accept": "application/json"
    })
    try:
        with urllib.request.urlopen(request, timeout=65) as response:
            payload = json.load(response)
    except urllib.error.HTTPError as error:
        raise RuntimeError("Search " + dep + " HTTP " + str(error.code)) from None
    jobs = payload.get("jobs") or []
    recruiters = payload.get("recruiters") or []
    sources = Counter(
        str((job.get("identifier") or {}).get("partner_label") or "source_inconnue")
        for job in jobs if isinstance(job, dict)
    )
    rows = {
        "department": dep,
        "total_jobs_returned": len(jobs),
        "recruiters_returned": len(recruiters),
        "source_counts": sources.most_common(18),
        "target_counts": {name: sources[name] for name in TARGETS},
        "sources_at_150": [name for name, count in sources.items() if count == 150],
        "warnings_count": len(payload.get("warnings") or []),
        "observed_at": datetime.now(timezone.utc).isoformat()
    }
    report["departments"].append(rows)
print("=== SEARCH DIRECTE 29/75/974 ===")
print(json.dumps(report, indent=2, ensure_ascii=False))
summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
if summary_path:
    lines = [
        "## Diagnostic en lecture seule : API /job/v1/search",
        "", "| Departement | Source | Resultats recherche | Export du 09/10 |",
        "|---|---|---:|---:|"
    ]
    expected = {
        ("29","Bretagne Alternance - Agence 6tm"): 338,
        ("75","offres_emploi_lba"): 716,
        ("75","France Travail"): 303,
        ("974","France Travail"): 504,
    }
    for (dep, source), count in expected.items():
        item = next(r for r in report["departments"] if r["department"] == dep)
        lines.append(f"| {dep} | {source} | {item['target_counts'][source]} | {count} |")
    lines.extend(["", "*La recherche est executee au moment du test, l'export compare date du 09/10 a 03h Paris.*", ""])
    with open(summary_path,"a",encoding="utf-8") as out:
        out.write("\n".join(lines))
