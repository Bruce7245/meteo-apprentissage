#!/usr/bin/env bash
set -euo pipefail

cd "$HOME/apprentifr"

ADMIN_KEY="$(cat "$HOME/apprentifr/.backfill_admin_key.local")"
BASE_URL="https://europe-west1-meteo-apprentissage.cloudfunctions.net"
LOG_DIR="logs/insee-56-65-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$LOG_DIR"

call_import() {
  local dep="$1"
  local cursor="$2"

  curl -sS -G \
    -H "x-admin-key: ${ADMIN_KEY}" \
    --data-urlencode "department=${dep}" \
    --data-urlencode "write=1" \
    --data-urlencode "pageSize=500" \
    --data-urlencode "maxPages=1" \
    --data-urlencode "cursor=${cursor}" \
    --data-urlencode "employerOnly=1" \
    --data-urlencode "activeOnly=0" \
    "${BASE_URL}/importInseeDepartmentEstablishmentsHttp"
}

run_aggregation() {
  local dep="$1"

  echo
  echo "===== AGREGATION SECTEURS ${dep} ====="

  curl -sS \
    -H "x-admin-key: ${ADMIN_KEY}" \
    "${BASE_URL}/buildInseeDepartmentStatsLightHttp?department=${dep}&write=1" \
    | tee "${LOG_DIR}/${dep}-sector-stats.json" \
    | jq '{ok, departmentCode, scannedCount, totals, sectorsCount, topSectors}'

  echo
  echo "===== AGREGATION NAF ${dep} ====="

  curl -sS \
    -H "x-admin-key: ${ADMIN_KEY}" \
    "${BASE_URL}/buildInseeDepartmentNafStatsHttp?department=${dep}&write=1" \
    | tee "${LOG_DIR}/${dep}-naf-stats.json" \
    | jq '{
      ok,
      departmentCode,
      scannedCount,
      establishmentsCount,
      activeEstablishmentsCount,
      activeEmployerEstablishmentsCount,
      nafCount,
      topNaf: [.topNaf[0:10][] | {
        nafCode,
        sectorCode,
        activeEmployerEstablishmentsCount,
        sirensCount
      }]
    }'
}

import_department() {
  local dep="$1"
  local cursor="*"
  local page=0
  local total_received=0
  local total_kept=0
  local total_written=0
  local max_pages=700

  echo
  echo "=================================================="
  echo "IMPORT INSEE DEPARTEMENT ${dep}"
  echo "=================================================="

  while true
  do
    page=$((page + 1))

    if [ "$page" -gt "$max_pages" ]; then
      echo "STOP securite : trop de pages pour ${dep}"
      exit 1
    fi

    set +e
    response="$(call_import "$dep" "$cursor")"
    curl_status=$?
    set -e

    if [ "$curl_status" -ne 0 ] || [ -z "$response" ]; then
      echo "Erreur reseau curl sur ${dep}, page ${page}. Pause 60 secondes puis reprise meme curseur..."
      page=$((page - 1))
      sleep 60
      continue
    fi

    echo "$response" > "${LOG_DIR}/${dep}-page-${page}.json"

    ok="$(echo "$response" | jq -r '.ok // false')"

    if [ "$ok" != "true" ]; then
      status="$(echo "$response" | jq -r '.status // empty')"

      if [ "$status" = "429" ]; then
        echo "Rate limit INSEE sur ${dep}, page ${page}. Pause 75 secondes puis reprise meme curseur..."
        page=$((page - 1))
        sleep 75
        continue
      fi

      echo "$response" | jq
      echo "Erreur import ${dep}, page ${page}"
      exit 1
    fi

    received="$(echo "$response" | jq -r '.receivedCount // 0')"
    kept="$(echo "$response" | jq -r '.keptCount // 0')"
    written="$(echo "$response" | jq -r '.writtenCount // 0')"
    complete="$(echo "$response" | jq -r '.complete')"
    next_cursor="$(echo "$response" | jq -r '.nextCursor // ""')"
    unknown_naf="$(echo "$response" | jq -r '.nafCounter.UNKNOWN // 0')"

    total_received=$((total_received + received))
    total_kept=$((total_kept + kept))
    total_written=$((total_written + written))

    echo "Dep ${dep} | page ${page} | recus=${received} | gardes=${kept} | ecrits=${written} | UNKNOWN_NAF=${unknown_naf} | total=${total_written} | complete=${complete}"

    if [ "$complete" = "true" ] || [ -z "$next_cursor" ] || [ "$received" = "0" ]; then
      echo "Import termine ${dep} | recus=${total_received} | gardes=${total_kept} | ecrits=${total_written}"
      break
    fi

    cursor="$next_cursor"
    sleep 2.5
  done

  run_aggregation "$dep"
  sleep 3
}

for dep in 56 57 58 59 60 61 62 63 64 65
do
  import_department "$dep"
done

echo
echo "IMPORT 56 A 65 TERMINE"
echo "Logs : ${LOG_DIR}"
