"""ApprentiFR: mesure agregee des champs ROME et localisation export LBA / Firestore.

Lecture seule: 1 appel /job/v1/export; 1 lien signe telecharge; aucune ecriture.
N'enregistre ni n'affiche offre individuelle, adresse, employeur, titre ou identifiant.
"""
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
from urllib.parse import urlsplit
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

EXPORT_ENDPOINT = "https://api.apprentissage.beta.gouv.fr/api/job/v1/export"
TOKEN = os.environ["API_APPRENTISSAGE_TOKEN"]
DATE = "2026-10-08"
PROJECT_ID = "meteo-apprentissage"
ROME_RE = re.compile(r"^[A-Z]\d{4}$")
ZIP_RE = re.compile(r"\b(\d{5})\b")
FEATURES = [
    "rome_valid", "rome_any", "rome_multiple", "city_direct",
    "city_in_address_object", "city_after_postcode_in_address_string",
    "city_usable", "postal_direct", "postal_in_address", "postal_usable",
    "location_address", "geopoint", "department_derived",
    "creation_date", "expiration_date", "naf", "siret"
]

def clean_str(value):
    return str(value).strip() if isinstance(value, str) and value.strip() else None

def location_fields(location):
    loc = location if isinstance(location, dict) else {}
    addr = loc.get("address")
    city_direct = clean_str(loc.get("city"))
    city_object = clean_str(addr.get("city")) if isinstance(addr, dict) else None
    postal_direct = any(clean_str(loc.get(k)) for k in ("zipcode", "postal_code", "postcode"))
    postal_address = False
    inferred_city = False
    addr_string = addr if isinstance(addr, str) else ""
    if isinstance(addr, dict):
        postal_address = any(clean_str(addr.get(k)) for k in ("zipcode","postal_code","postcode"))
        addr_string = clean_str(addr.get("label")) or clean_str(addr.get("address")) or ""
    match = ZIP_RE.search(addr_string)
    if match:
        postal_address = True
        suffix = addr_string[match.end():].strip(" ,;")
        # Cette heuristique n'est PAS une commune certifiee.
        inferred_city = bool(suffix and re.search(r"[A-Za-zÀ-ÿ]", suffix))
    post = postal_direct or postal_address
    geo = loc.get("geopoint")
    department = clean_str(loc.get("department"))
    return {
        "city_direct": bool(city_direct),
        "city_in_address_object": bool(city_object),
        "city_after_postcode_in_address_string": bool(inferred_city),
        "city_usable": bool(city_direct or city_object or inferred_city),
        "postal_direct": bool(postal_direct),
        "postal_in_address": bool(postal_address),
        "postal_usable": bool(post),
        "location_address": bool(addr_string or (isinstance(addr, dict) and addr)),
        "geopoint": bool(geo),
        "department_derived": bool(department or post),
    }

def export_features(job):
    offer = job.get("offer") or {}
    work = job.get("workplace") or {}
    loc = work.get("location") or {}
    raws = offer.get("rome_codes") or []
    romes = [str(x).upper() for x in raws if isinstance(x, str) and clean_str(x)] if isinstance(raws, list) else []
    valid = [x for x in romes if ROME_RE.fullmatch(x)]
    pub = offer.get("publication") or {}
    domain = work.get("domain") or {}
    feats = location_fields(loc)
    feats.update({
        "rome_valid": bool(valid),
        "rome_any": bool(romes),
        "rome_multiple": len(set(valid)) >= 2,
        "creation_date": bool(pub.get("creation")),
        "expiration_date": bool(pub.get("expiration")),
        "naf": bool((domain.get("naf") or {}).get("code") if isinstance(domain.get("naf"), dict) else domain.get("naf")),
        "siret": bool(work.get("siret")),
    })
    return feats

def fs_features(row):
    romes = row.get("romeCodes") or []
    valid = [x for x in romes if isinstance(x, str) and ROME_RE.fullmatch(x)] if isinstance(romes,list) else []
    city = clean_str(row.get("city"))
    postal = clean_str(row.get("postalCode"))
    return {
        "rome_valid": bool(valid),
        "rome_any": bool(romes),
        "rome_multiple": len(set(valid))>=2,
        "city_direct": bool(city),
        "city_in_address_object": False,
        "city_after_postcode_in_address_string": False,
        "city_usable": bool(city),
        "postal_direct": bool(postal),
        "postal_in_address": False,
        "postal_usable": bool(postal),
        "location_address": False,
        "geopoint": False,
        "department_derived": bool(row.get("effectiveDepartmentCode")),
        "creation_date": bool(row.get("publicationCreationDate")),
        "expiration_date": bool(row.get("publicationExpirationDate")),
        "naf": bool(row.get("nafCode")),
        "siret": bool(row.get("siret")),
    }

def extract_keys(job):
    ident = job.get("identifier") or {}
    source = str(ident.get("partner_label") or "source_inconnue")
    pid = str(ident.get("partner_job_id") or "")
    raw = ident.get("id") or (source + ":" + (pid or "unknown"))
    digest = sha256(str(raw).encode("utf-8")).hexdigest()
    return source, pid, digest

def source_totals(rows):
    result = {}
    grouped = defaultdict(list)
    for r in rows:
        grouped[r["source"]].append(r)
    for source, cohort in sorted(grouped.items(), key=lambda e: -len(e[1]))[:15]:
        result[source] = {
            "offers": len(cohort),
            "rome_valid": sum(r["features"]["rome_valid"] for r in cohort),
            "city_explicit": sum(r["features"]["city_direct"] or r["features"]["city_in_address_object"] for r in cohort),
            "city_heuristic_or_explicit": sum(r["features"]["city_usable"] for r in cohort),
            "postal_usable": sum(r["features"]["postal_usable"] for r in cohort),
            "geopoint": sum(r["features"]["geopoint"] for r in cohort)
        }
    return result

def aggregate(rows):
    totals = Counter()
    for row in rows:
        totals.update({k: 1 for k in FEATURES if row["features"].get(k)})
    return {"total": len(rows), **{k: totals[k] for k in FEATURES}}

def read_firestore():
    db = firestore.Client(project=PROJECT_ID)
    deps = list(db.collection("dailyOfferSnapshots").document(DATE).collection("departments").stream())
    if len(deps) != 101:
        raise RuntimeError(f"Firestore : {len(deps)} departements au lieu de 101")
    def read_one(doc):
        data = doc.to_dict() or {}
        active = data.get("activeRunId")
        if not active or data.get("date") != DATE:
            raise RuntimeError("Metadonnees de photographie inexploitables pour " + doc.id)
        rows = []
        for snap in doc.reference.collection("offers").where(
            filter=FieldFilter("runId","==",active)
        ).stream():
            item=snap.to_dict() or {}
            rows.append({
                "source": str(item.get("partnerLabel") or "source_inconnue"),
                "pid": str(item.get("partnerJobId") or ""),
                "digest": str(item.get("offerDocId") or snap.id),
                "strict": item.get("locationQuality") == "in_department",
                "features": fs_features(item)
            })
        strict = data.get("strictSummary") or {}
        if sum(r["strict"] for r in rows) != int(strict.get("totalOffers") or 0):
            raise RuntimeError("Incoherence stricte dans la photographie " + doc.id)
        return rows
    all_rows=[]
    with ThreadPoolExecutor(max_workers=9) as pool:
        futures=[pool.submit(read_one, doc) for doc in deps]
        for done in as_completed(futures):
            all_rows.extend(done.result())
    return all_rows

def input_stream(path):
    with open(path, "rb") as file:
        compressed = file.read(2) == b"\x1f\x8b"
    return gzip.open(path, "rb") if compressed else open(path,"rb")

def export():
    req=urllib.request.Request(EXPORT_ENDPOINT,headers={
        "Accept":"application/json", "Authorization": "Bearer "+TOKEN
    })
    try:
        with urllib.request.urlopen(req,timeout=60) as response:
            meta=json.load(response)
    except urllib.error.HTTPError as e:
        raise RuntimeError("API export HTTP "+str(e.code)) from None
    signed=meta.get("url")
    if not isinstance(signed,str) or urlsplit(signed).scheme!="https":
        raise RuntimeError("Lien export signe HTTPS absent")
    with tempfile.TemporaryDirectory(prefix="apprentifr-coverage-") as dir:
        path=Path(dir)/"export.bin"
        try:
            with urllib.request.urlopen(signed,timeout=120) as response:
                with open(path,"wb") as out:
                    shutil.copyfileobj(response,out,length=1024*1024)
        except urllib.error.HTTPError as e:
            raise RuntimeError("Telechargement export HTTP "+str(e.code)) from None
        with input_stream(path) as file:
            prefix=None
            for key,event,_ in ijson.parse(file):
                if event=="start_array" and key in ("","jobs","offers","data.jobs","data.offers"):
                    prefix=(key+".item") if key else "item"
                    break
        if prefix is None:
            raise RuntimeError("Format de l'export non reconnu")
        rows=[]
        raw=0
        recruiters=0
        geo_keys=Counter()
        address_keys=Counter()
        address_types=Counter()
        with input_stream(path) as file:
            for job in ijson.items(file,prefix):
                raw+=1
                if not isinstance(job,dict) or not isinstance(job.get("offer"),dict):
                    continue
                source,pid,digest=extract_keys(job)
                if source=="recruteurs_lba":
                    recruiters+=1
                    continue
                loc=(job.get("workplace") or {}).get("location") or {}
                if isinstance(loc,dict):
                    geo_keys.update(loc.keys())
                    addr=loc.get("address")
                    if addr is not None:
                        address_types[type(addr).__name__]+=1
                        if isinstance(addr,dict):
                            address_keys.update(addr.keys())
                rows.append({"source":source,"pid":pid,"digest":digest,"features":export_features(job)})
        return rows, {
            "last_update":meta.get("lastUpdate"),
            "file_bytes":path.stat().st_size,
            "raw_rows":raw,"recruiters_excluded":recruiters,
            "location_keys":dict(geo_keys.most_common(18)),
            "address_types":dict(address_types),
            "address_object_keys":dict(address_keys.most_common(18))
        }

fs=read_firestore()
exp,meta=export()
fs_ids=set()
for row in fs:
    fs_ids.add((row["source"],"digest",row["digest"]))
    if row["pid"]:
        fs_ids.add((row["source"],"pid",row["pid"]))
def matches_fs(r):
    return (r["source"],"digest",r["digest"]) in fs_ids or (bool(r["pid"]) and (r["source"],"pid",r["pid"]) in fs_ids)

fs_strict=[r for r in fs if r["strict"]]
matched=[r for r in exp if matches_fs(r)]
export_only=[r for r in exp if not matches_fs(r)]

result={
    "date_reference_firestore":DATE,
    "export_last_update":meta["last_update"],
    "export_api_calls":1,
    "read_only":True,
    "export_file_bytes":meta["file_bytes"],
    "export_total_rows":meta["raw_rows"],
    "export_recruiters_excluded":meta["recruiters_excluded"],
    "location_schema_keys":meta["location_keys"],
    "address_value_types":meta["address_types"],
    "address_object_keys":meta["address_object_keys"],
    "export_offers":aggregate(exp),
    "export_matched_firestore":aggregate(matched),
    "export_absent_firestore":aggregate(export_only),
    "firestore_strict":aggregate(fs_strict),
    "firestore_all":aggregate(fs),
    "major_export_sources":source_totals(exp),
    "interpretation":"city_usable inclut une extraction heuristique apres code postal; seule city_direct ou city_in_address_object est une ville explicitement renseignee."
}
print("=== AUDIT DES CHAMPS ROME / VILLE / CODE POSTAL ===")
print(json.dumps(result,ensure_ascii=False,indent=2))

summary_path=os.environ.get("GITHUB_STEP_SUMMARY")
if summary_path:
    groups=[
        ("Export national",exp),
        ("Export absent de Firestore",export_only),
        ("Firestore stock strict",fs_strict)
    ]
    lines=["## Completude des champs - Export LBA et Firestore","",
           "| Jeu de donnees | Offres | ROME valide | Ville explicite | Ville (avec heuristique adresse) | Code postal |",
           "|---|---:|---:|---:|---:|---:|"]
    for name,rows in groups:
        a=aggregate(rows)
        explicit=sum(r["features"]["city_direct"] or r["features"]["city_in_address_object"] for r in rows)
        lines.append(f"| {name} | {len(rows)} | {a['rome_valid']} | {explicit} | {a['city_usable']} | {a['postal_usable']} |")
    lines.extend(["","*Ville reconstituee depuis une adresse = heuristique, pas identification INSEE certifiee. Lecture seule.*",""])
    with open(summary_path,"a",encoding="utf-8") as out:
        out.write("\n".join(lines))
