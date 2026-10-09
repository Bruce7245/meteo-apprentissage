"""Audit ponctuel en lecture seule. Export LBA national versus Firestore, 08/10/2026.

Un appel a /job/v1/export, un telechargement, streaming, aucun fichier conserve.
Aucun titre, nom, adresse ni identifiant individuel ne figure dans les logs.
"""
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from hashlib import sha256
from pathlib import Path
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo
import gzip
import json
import os
import re
import shutil
import tempfile
import urllib.error
import urllib.request

import ijson
from google.cloud import firestore
from google.cloud.firestore_v1.base_query import FieldFilter

DATE = "2026-10-08"
PROJECT = "meteo-apprentissage"
TOKEN = os.environ.get("API_APPRENTISSAGE_TOKEN", "")
ENDPOINT = "https://api.apprentissage.beta.gouv.fr/api/job/v1/export"
PARIS = ZoneInfo("Europe/Paris")

if not TOKEN:
    raise SystemExit("Cle API non fournie")

def date_paris(value):
    if not isinstance(value, str) or not value:
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return (dt.astimezone(PARIS) if dt.tzinfo else dt).date().isoformat()
    except ValueError:
        return None

def location_dept(job):
    work = job.get("workplace") or {}
    loc = work.get("location") or {}
    if not isinstance(loc, dict):
        loc = {}
    direct = loc.get("department") or job.get("department")
    if isinstance(direct, str):
        code = direct.strip().upper()
        if re.fullmatch(r"(?:0[1-9]|[1-8][0-9]|9[0-5]|2A|2B|97[1-6])", code):
            return code
    fields = [
        loc.get("zipcode"), loc.get("postcode"), loc.get("postal_code"),
        work.get("zipcode"), work.get("postal_code"), loc.get("address"), work.get("address")
    ]
    for raw in fields:
        if isinstance(raw, dict):
            raw = (raw.get("zipcode") or raw.get("postal_code")
                   or raw.get("postcode") or raw.get("label"))
        if not isinstance(raw, str):
            continue
        match = re.search(r"\b(\d{5})\b", raw)
        if not match:
            continue
        post = match.group(1)
        if re.fullmatch(r"97[1-6]\d{2}", post):
            return post[:3]
        if post.startswith("20"):
            if 20000 <= int(post) <= 20199:
                return "2A"
            if 20200 <= int(post) <= 20699:
                return "2B"
            return None
        return post[:2]
    return None

def creation(job):
    pub = (job.get("offer") or {}).get("publication") or {}
    return date_paris(pub.get("creation") or (job.get("publication") or {}).get("creation"))

def export_identifier(job):
    ident = job.get("identifier") or {}
    partner = str(ident.get("partner_label") or "source_inconnue")
    pid = str(ident.get("partner_job_id") or "")
    identity = str(ident.get("id") or "")
    # Conforme a getJobId + stableOfferDocId dans le depot ApprentiFR.
    raw = identity or (partner + ":" + (pid or "unknown"))
    digest = sha256(raw.encode("utf-8")).hexdigest()
    return partner, pid, digest, identity

def input_stream(path):
    with open(path, "rb") as f:
        zipped = f.read(2) == b"\x1f\x8b"
    return gzip.open(path, "rb") if zipped else open(path, "rb")

def array_prefix(path):
    allowed = {
        "", "jobs", "offers", "offres", "items", "results",
        "data.jobs", "data.offers", "data.offres",
        "data.items", "data.results", "export.jobs", "export.offers"
    }
    with input_stream(path) as f:
        for prefix, event, _ in ijson.parse(f):
            if event == "start_array" and prefix in allowed:
                return prefix + ".item" if prefix else "item"
    raise RuntimeError("Format export national non reconnu")

def top(counter, n=12):
    return [{"source": str(k), "count": v} for k, v in counter.most_common(n)]

def firestore_rows():
    client = firestore.Client(project=PROJECT)
    snapshots = list(client.collection("dailyOfferSnapshots")
                     .document(DATE).collection("departments").stream())
    def read_dept(snap):
        data = snap.to_dict() or {}
        active = data.get("activeRunId")
        strict = data.get("strictSummary") or {}
        if data.get("date") != DATE or not active or "totalOffers" not in strict:
            return {"valid": False, "department": snap.id}, []
        docs = snap.reference.collection("offers").where(
            filter=FieldFilter("runId", "==", active)
        ).stream()
        rows = []
        for item in docs:
            row = item.to_dict() or {}
            rows.append({
                "source": str(row.get("partnerLabel") or "source_inconnue"),
                "pid": str(row.get("partnerJobId") or ""),
                "doc_id": str(row.get("offerDocId") or item.id),
                "created": str(row.get("publicationCreationDate") or "")[:10] or None,
                "strict": row.get("locationQuality") == "in_department",
                "dept": snap.id,
                "effective_dept": str(row.get("effectiveDepartmentCode") or ""),
            })
        return {
            "valid": True, "department": snap.id,
            "strict_summary": int(strict.get("totalOffers") or 0),
            "stored_summary": int(data.get("storedOffersCount") or 0),
            "strict_observed": sum(r["strict"] for r in rows),
            "observed": len(rows),
            "imported_at": data["importedAt"].isoformat() if data.get("importedAt") else None
        }, rows

    metadata, observations = [], []
    with ThreadPoolExecutor(max_workers=8) as pool:
        futures = [pool.submit(read_dept, s) for s in snapshots]
        for future in as_completed(futures):
            meta, docs = future.result()
            metadata.append(meta)
            observations.extend(docs)
    if len(metadata) != 101 or len([m for m in metadata if m["valid"]]) != 101:
        raise RuntimeError("Qualite Firestore : absence de 101 departements valides")
    if any(m["strict_summary"] != m["strict_observed"] or
           m["stored_summary"] != m["observed"] for m in metadata):
        raise RuntimeError("Qualite Firestore : des nombres stockes ne concordent pas")
    return metadata, observations

def export_rows():
    req = urllib.request.Request(ENDPOINT, headers={
        "Authorization": "Bearer " + TOKEN, "Accept": "application/json"
    })
    try:
        with urllib.request.urlopen(req, timeout=45) as resp:
            meta = json.load(resp)
    except urllib.error.HTTPError as exc:
        raise RuntimeError("API export : HTTP " + str(exc.code)) from None
    signed = meta.get("url")
    if not isinstance(signed, str) or urlsplit(signed).scheme != "https":
        raise RuntimeError("L'API export n'a pas retourne de lien HTTPS")
    with tempfile.TemporaryDirectory(prefix="apprentifr-audit-") as directory:
        path = Path(directory) / "export.bin"
        try:
            with urllib.request.urlopen(signed, timeout=120) as response:
                with path.open("wb") as file:
                    shutil.copyfileobj(response, file, length=1024 * 1024)
        except urllib.error.HTTPError as exc:
            raise RuntimeError("Fichier export : HTTP " + str(exc.code)) from None
        total = 0
        recruiters = 0
        without_offer = 0
        records = []
        with input_stream(path) as f:
            for job in ijson.items(f, array_prefix(path)):
                total += 1
                if not isinstance(job, dict) or not isinstance(job.get("offer"), dict):
                    without_offer += 1
                    continue
                partner, pid, digest, identity = export_identifier(job)
                if partner == "recruteurs_lba":
                    recruiters += 1
                    continue
                records.append({
                    "source": partner, "pid": pid, "doc_id": digest,
                    "created": creation(job), "dept": location_dept(job),
                    "identity": identity, "status": str((job.get("offer") or {}).get("status") or "")
                })
        return meta, {
            "bytes": path.stat().st_size, "rows": total,
            "recruiters": recruiters, "not_offer": without_offer,
        }, records

fs_meta, fs = firestore_rows()
api_meta, export_meta, exp_all = export_rows()

fs_by_pid = defaultdict(set)
fs_by_hash = defaultdict(set)
for i, row in enumerate(fs):
    if row["pid"]:
        fs_by_pid[(row["source"], row["pid"])].add(i)
    if row["doc_id"]:
        fs_by_hash[(row["source"], row["doc_id"])].add(i)

# De-dupliquer par identifiant de l'API, sans utiliser titres, entreprises ou adresses.
deduped = []
seen_export = set()
for row in exp_all:
    key = (row["source"], row["identity"] or ("pid:" + row["pid"]))
    if not row["identity"] and not row["pid"]:
        key = (row["source"], "hash:" + row["doc_id"])
    if key not in seen_export:
        seen_export.add(key)
        deduped.append(row)

matched_fs = set()
matched_exp = 0
matched_exp_strict = 0
matched_new_exp = 0
matched_new_exp_fs_created_same = 0
match_pid = 0
match_hash = 0
match_both = 0
matched_dept_agrees = 0
matched_dept_disagrees = 0
source_export, source_fs, source_fs_strict = Counter(), Counter(), Counter()
source_exp_new, source_fs_new, source_fs_new_strict = Counter(), Counter(), Counter()
source_matched, source_export_only, source_export_new_only = Counter(), Counter(), Counter()
source_fs_only, source_fs_new_only = Counter(), Counter()
dept_export, dept_fs_strict, dept_exp_unmatched = Counter(), Counter(), Counter()
fs_08 = set()

for i, row in enumerate(fs):
    source_fs[row["source"]] += 1
    if row["strict"]:
        source_fs_strict[row["source"]] += 1
        dept_fs_strict[row["dept"]] += 1
    if row["created"] == DATE:
        fs_08.add(i)
        source_fs_new[row["source"]] += 1
        if row["strict"]:
            source_fs_new_strict[row["source"]] += 1

for row in deduped:
    source = row["source"]
    source_export[source] += 1
    if row["dept"]:
        dept_export[row["dept"]] += 1
    if row["created"] == DATE:
        source_exp_new[source] += 1

    pid_hits = fs_by_pid.get((source, row["pid"]), set()) if row["pid"] else set()
    hash_hits = fs_by_hash.get((source, row["doc_id"]), set())
    hits = pid_hits | hash_hits
    if hits:
        matched_exp += 1
        source_matched[source] += 1
        matched_fs.update(hits)
        match_pid += bool(pid_hits)
        match_hash += bool(hash_hits)
        match_both += bool(pid_hits and hash_hits)
        if any(fs[i]["strict"] for i in hits):
            matched_exp_strict += 1
        if row["created"] == DATE:
            matched_new_exp += 1
            if any(fs[i]["created"] == DATE for i in hits):
                matched_new_exp_fs_created_same += 1
        for i in hits:
            if fs[i]["strict"] and row["dept"]:
                if fs[i]["dept"] == row["dept"]:
                    matched_dept_agrees += 1
                else:
                    matched_dept_disagrees += 1
                break
    else:
        source_export_only[source] += 1
        if row["created"] == DATE:
            source_export_new_only[source] += 1
        if row["dept"]:
            dept_exp_unmatched[row["dept"]] += 1

for i, row in enumerate(fs):
    if i not in matched_fs:
        source_fs_only[row["source"]] += 1
        if row["created"] == DATE:
            source_fs_new_only[row["source"]] += 1

src_all = source_export | source_fs
source_detail = []
for source in src_all:
    source_detail.append({
        "source": source,
        "export_total": source_export[source],
        "firestore_stock_strict": source_fs_strict[source],
        "firestore_stock_all": source_fs[source],
        "export_matched": source_matched[source],
        "export_only": source_export_only[source],
        "firestore_only": source_fs_only[source],
        "export_created_08": source_exp_new[source],
        "firestore_created_08_strict": source_fs_new_strict[source],
        "export_created_08_not_found_in_firestore": source_export_new_only[source]
    })
source_detail.sort(key=lambda r: (-r["export_total"], -r["firestore_stock_strict"], r["source"]))

report = {
    "date_reference": DATE,
    "export_actualise": api_meta.get("lastUpdate"),
    "read_only": True,
    "api_export_calls": 1,
    "signed_downloads": 1,
    "export_total_rows_including_recruiters": export_meta["rows"],
    "export_recruiters_excluded": export_meta["recruiters"],
    "export_offers_raw": len(exp_all),
    "export_offers_deduplicated": len(deduped),
    "export_offers_with_department": sum(bool(row["dept"]) for row in deduped),
    "export_created_oct08": sum(row["created"] == DATE for row in deduped),
    "firestore_depts": len(fs_meta),
    "firestore_total_stored": len(fs),
    "firestore_strict": sum(row["strict"] for row in fs),
    "firestore_created_oct08_all": len(fs_08),
    "firestore_created_oct08_strict": sum(fs[i]["strict"] for i in fs_08),
    "overlap_export_to_firestore_any_quality": matched_exp,
    "overlap_export_to_firestore_strict": matched_exp_strict,
    "export_only": len(deduped) - matched_exp,
    "firestore_only_all": len(fs) - len(matched_fs),
    "firestore_only_strict": sum(row["strict"] and i not in matched_fs for i,row in enumerate(fs)),
    "export_oct08_present_in_firestore": matched_new_exp,
    "export_oct08_present_in_firestore_same_creation_date": matched_new_exp_fs_created_same,
    "export_oct08_absent_from_firestore": sum(row["created"] == DATE for row in deduped) - matched_new_exp,
    "match_diagnostics": {
        "partner_job_id": match_pid,
        "sha256_lba_id": match_hash,
        "both": match_both,
        "departments_agree_on_matched_strict": matched_dept_agrees,
        "departments_disagree_on_matched_strict": matched_dept_disagrees,
    },
    "first_firestore_imported": min((m["imported_at"] for m in fs_meta if m["imported_at"]), default=None),
    "last_firestore_imported": max((m["imported_at"] for m in fs_meta if m["imported_at"]), default=None),
    "sources": source_detail[:22],
    "top_export_created_oct08_unmatched": top(source_export_new_only, 12),
    "top_firestore_created_oct08_unmatched": top(source_fs_new_only, 12),
    "top_departments_with_unmatched_export": top(dept_exp_unmatched, 12),
    "methodology_warning": "Export du 09/10 03h vs captures 08/10 23h59-09/10 00h04. Comparaison de memes ID, pas une preuve directe de saturation."
}
print("=== AUDIT COMPARATIF PAR IDENTIFIANTS - 08/10 ===")
print(json.dumps(report, ensure_ascii=False, indent=2))
path = os.environ.get("GITHUB_STEP_SUMMARY")
if path:
    summary_lines = [
        "## Export LBA / Firestore : audit par identifiant (08/10/2026)",
        "", "| Mesure | Volume |", "|---|---:|",
        f"| Export, offres uniques | {len(deduped)} |",
        f"| Firestore, stock strict | {report['firestore_strict']} |",
        f"| Export retrouve dans Firestore (toutes qualites) | {matched_exp} |",
        f"| Export absent de Firestore | {report['export_only']} |",
        f"| Firestore strict absent de l'export | {report['firestore_only_strict']} |",
        f"| Export cree le 08/10 | {report['export_created_oct08']} |",
        f"| Dont retrouve dans Firestore | {matched_new_exp} |",
        f"| Dont absent de Firestore | {report['export_oct08_absent_from_firestore']} |",
        "", "### Repartition par source (principales)", "",
        "| Source | Export stock | Firestore strict | Apparitions export absentes FS | Creees 08 export | Creees 08 export absentes FS |",
        "|---|---:|---:|---:|---:|---:|"
    ]
    for row in source_detail[:20]:
        safe_source = row["source"].replace("|", " ").replace("\n", " ")[:60]
        summary_lines.append(
            f"| {safe_source} | {row['export_total']} | {row['firestore_stock_strict']} "
            f"| {row['export_only']} | {row['export_created_08']} "
            f"| {row['export_created_08_not_found_in_firestore']} |"
        )
    summary_lines.extend(["", "*En lecture seule. Dates de collecte decalees : ne pas assimiler absence a une disparition certaine.*", ""])
    with open(path, "a", encoding="utf-8") as summary:
        summary.write("\n".join(summary_lines))
