"""Telecharge UN export national LBA et le convertit en NDJSON temporaire.

Un seul GET /api/job/v1/export + un seul GET du lien signe.
Aucun log des offres, URL signee, entreprise, cle API ou adresse.
Les fichiers NDJSON et meta restent sur le runner et sont supprimes a la fin du job.
"""
import argparse
from datetime import datetime, timedelta, timezone
import gzip
from hashlib import sha256
import ijson
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
from urllib.parse import urlsplit
import urllib.error
import urllib.request

EXPORT_ENDPOINT = "https://api.apprentissage.beta.gouv.fr/api/job/v1/export"
PREFIXES = {
    "", "jobs", "offers", "offres", "items", "results",
    "data.jobs", "data.offers", "data.offres", "data.items", "data.results",
    "export.jobs", "export.offers",
}

def load_export_url(token):
    req = urllib.request.Request(
        EXPORT_ENDPOINT,
        headers={"Accept": "application/json", "Authorization": "Bearer " + token},
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as response:
            metadata = json.load(response)
    except urllib.error.HTTPError as ex:
        raise RuntimeError(f"API /job/v1/export: HTTP {ex.code}") from None
    url = metadata.get("url")
    if not isinstance(url, str) or urlsplit(url).scheme != "https":
        raise ValueError("L'API n'a pas retourne de lien d'export HTTPS")
    updated = metadata.get("lastUpdate")
    if not updated:
        raise ValueError("Horodatage de l'export absent : pas d'import")
    stamp = datetime.fromisoformat(updated.replace("Z", "+00:00"))
    if not stamp.tzinfo:
        raise ValueError("Horodatage sans fuseau")
    age = datetime.now(timezone.utc) - stamp.astimezone(timezone.utc)
    if age < timedelta(minutes=-15) or age > timedelta(hours=48):
        raise ValueError("Export obsolete ou date future : aucun import")
    return url, updated

def input_stream(path):
    with path.open("rb") as file:
        compressed = file.read(2) == b"\x1f\x8b"
    return gzip.open(path, "rb") if compressed else path.open("rb")

def detect_prefix(path):
    with input_stream(path) as data:
        for prefix, event, _value in ijson.parse(data):
            if event == "start_array" and prefix in PREFIXES:
                return prefix + ".item" if prefix else "item"
    raise ValueError("Format de l'export non reconnu")

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True)
    parser.add_argument("--meta", required=True)
    args = parser.parse_args()
    token = os.environ.get("API_APPRENTISSAGE_TOKEN")
    if not token:
        raise SystemExit("Secret API_APPRENTISSAGE_TOKEN absent")
    signed_url, update_at = load_export_url(token)
    with tempfile.TemporaryDirectory(prefix="apprentifr-export-download-") as scratch:
        compressed_path = Path(scratch) / "signed-export"
        digest = sha256()
        size = 0
        try:
            with urllib.request.urlopen(signed_url, timeout=120) as response:
                with compressed_path.open("wb") as file:
                    while chunk := response.read(1024 * 1024):
                        file.write(chunk)
                        digest.update(chunk)
                        size += len(chunk)
        except urllib.error.HTTPError as ex:
            raise RuntimeError(f"Telechargement export: HTTP {ex.code}") from None
        if size < 100000:
            raise ValueError("Export anormalement petit : import refuse")

        prefix = detect_prefix(compressed_path)
        jobs = 0
        recruiters = 0
        rows = 0
        invalid_offers = 0
        seen = set()
        temporary_ndjson = Path(args.out + ".partial")
        try:
            with input_stream(compressed_path) as source, temporary_ndjson.open(
                "w", encoding="utf-8"
            ) as dest:
                for job in ijson.items(source, prefix):
                    rows += 1
                    if not isinstance(job, dict) or not isinstance(job.get("offer"), dict):
                        invalid_offers += 1
                        continue
                    ident = job.get("identifier") or {}
                    if ident.get("partner_label") == "recruteurs_lba":
                        recruiters += 1
                        continue
                    # Retenir les identifiants pour verifier les duplications
                    # sans logguer les valeurs.
                    key = str(ident.get("id") or (
                        str(ident.get("partner_label") or "") + ":" +
                        str(ident.get("partner_job_id") or "")
                    ))
                    seen.add(key)
                    dest.write(json.dumps(job, ensure_ascii=False, separators=(",", ":")) + "\n")
                    jobs += 1
            if jobs < 7000 or len(seen) < 7000:
                raise ValueError("Export incomplet/identifiants insuffisants : import refuse")
            temporary_ndjson.replace(args.out)
        finally:
            if temporary_ndjson.exists():
                temporary_ndjson.unlink()

        meta = {
            "exportLastUpdate": update_at,
            "fileSha256": digest.hexdigest(),
            "fileSizeBytes": size,
            "rowsTotal": rows,
            "recruitersExcluded": recruiters,
            "invalidOfferRows": invalid_offers,
            "offerRows": jobs,
            "uniqueRawIdentifiers": len(seen),
            "sourceRoute": "/api/job/v1/export",
            "schemaVersion": "apprentifr.export.ndjson.v1",
        }
        Path(args.meta).write_text(
            json.dumps(meta, ensure_ascii=False), encoding="utf-8"
        )
        print(json.dumps({
            "success": True,
            "source": meta["sourceRoute"],
            "lastUpdate": update_at,
            "offers": jobs,
            "uniqueIds": len(seen),
            "recruitersExcluded": recruiters,
            "bytes": size,
        }, ensure_ascii=False))

if __name__ == "__main__":
    main()
