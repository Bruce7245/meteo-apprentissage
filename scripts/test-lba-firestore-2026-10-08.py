"""Lecture seule : compare la photographie Firestore du 08/10/2026 a l'export LBA."""
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import timezone
import json

from google.cloud import firestore
from google.cloud.firestore_v1.base_query import FieldFilter

DATE = "2026-10-08"
client = firestore.Client(project="meteo-apprentissage")
departments = list(client.collection("dailyOfferSnapshots").document(DATE).collection("departments").stream())

def inspect_department(snapshot):
    data = snapshot.to_dict() or {}
    code = snapshot.id
    active_run = data.get("activeRunId")
    strict_summary = data.get("strictSummary") or {}
    if data.get("date") != DATE or not active_run or "totalOffers" not in strict_summary:
        return {"code": code, "valid": False, "reason": "metadonnees incompletes"}
    observations = list(
        snapshot.reference.collection("offers")
        .where(filter=FieldFilter("runId", "==", active_run))
        .stream()
    )
    offers = [(row.to_dict() or {}) for row in observations]
    created = [row for row in offers if row.get("publicationCreationDate") == DATE]
    strict_offers = [row for row in offers if row.get("locationQuality") == "in_department"]
    strict_new = [row for row in created if row.get("locationQuality") == "in_department"]
    missing_created = sum(1 for row in offers if not row.get("publicationCreationDate"))
    def IDs(rows):
        return [
            (str(row.get("partnerLabel") or ""), str(row.get("partnerJobId") or row.get("lbaId") or row.get("offerDocId") or ""))
            for row in rows
        ]
    return {
        "code": code, "valid": True, "date": data.get("date"),
        "meta_strict": int(strict_summary.get("totalOffers") or 0),
        "meta_stored": int(data.get("storedOffersCount") or 0),
        "meta_openings": int(strict_summary.get("totalOpenings") or 0),
        "all_count": len(offers), "strict_count": len(strict_offers),
        "new_all": len(created), "new_strict": len(strict_new),
        "without_creation": missing_created,
        "ids_strict": IDs(strict_offers),
        "imported_at": data.get("importedAt").isoformat() if data.get("importedAt") else None,
        "sources_new_strict": dict(Counter(str(row.get("partnerLabel") or "inconnue") for row in strict_new)),
    }

results = []
with ThreadPoolExecutor(max_workers=8) as pool:
    futures = [pool.submit(inspect_department, snap) for snap in departments]
    for future in as_completed(futures):
        results.append(future.result())

valid = [r for r in results if r.get("valid")]
all_ids = [item for r in valid for item in r["ids_strict"]]
known = {pair for pair in all_ids if pair[0] and pair[1]}
new_sources = Counter()
for row in valid:
    new_sources.update(row["sources_new_strict"])
report = {
    "reference_date": DATE,
    "source": "Firestore/dailyOfferSnapshots/2026-10-08/departments",
    "mode": "lecture_seule",
    "departments_meta": len(departments),
    "departments_valid": len(valid),
    "departments_invalid": [r for r in results if not r.get("valid")],
    "strict_offers_summary": sum(r["meta_strict"] for r in valid),
    "strict_openings_summary": sum(r["meta_openings"] for r in valid),
    "total_stored_summary": sum(r["meta_stored"] for r in valid),
    "retrieved_offer_documents": sum(r["all_count"] for r in valid),
    "strict_in_department_documents": sum(r["strict_count"] for r in valid),
    "new_oct8_all_stored": sum(r["new_all"] for r in valid),
    "new_oct8_strict_departments": sum(r["new_strict"] for r in valid),
    "offers_without_creation_date": sum(r["without_creation"] for r in valid),
    "distinct_strict_known_ids": len(known),
    "departments_strict_match_summary": sum(r["strict_count"] == r["meta_strict"] for r in valid),
    "departments_stored_match_summary": sum(r["all_count"] == r["meta_stored"] for r in valid),
    "top_sources_new_oct8_strict": new_sources.most_common(12),
    "first_department_imported_at": min((r["imported_at"] for r in valid if r["imported_at"]), default=None),
    "last_department_imported_at": max((r["imported_at"] for r in valid if r["imported_at"]), default=None),
    "interpretation": "Stock observe dans les collectes dept du 08/10 et offres creees le 08/10. A comparer avec l'export national du 09/10, sous reserve des heures et perimetres.",
}
print("=== FIRESTORE 08/10 : RELEVE NATIONAL (READ-ONLY) ===")
print(json.dumps(report, indent=2, ensure_ascii=False))
if len(valid) != 101:
    raise SystemExit("Echec qualite : moins de 101 departements valides.")
