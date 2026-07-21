#!/usr/bin/env bash
set -euo pipefail

cd "$HOME/apprentifr"

ADMIN_KEY="$(cat "$HOME/apprentifr/.backfill_admin_key.local")"
BASE_URL="https://europe-west1-meteo-apprentissage.cloudfunctions.net"
LOG_DIR="logs/insee-2A-2B-21-30-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$LOG_DIR"

import_department() {
  DEP="$1"
  CURSOR="*"
  PAGE=0
  TOTAL_RECEIVED=0
  TOTAL_KEPT=0
  TOTAL_WRITTEN=0
  MAX_PAGES=700

  echo
  echo "=================================================="
  echo "IMPORT INSEE DEPARTEMENT ${DEP}"
  echo "=================================================="

  while true
  do
    PAGE=$((PAGE + 1))

    if [ "$PAGE" -gt "$MAX_PAGES" ]; then
      echo "STOP securite : trop de pages pour ${DEP}"
      exit 1
    fi

    RESPONSE="$(curl -sS -G \
      -H "x-admin-key: ${ADMIN_KEY}" \
      --data-urlencode "department=${DEP}" \
      --data-urlencode "write=1" \
      --data-urlencode "pageSize=500" \
      --data-urlencode "maxPages=1" \
      --data-urlencode "cursor=${CURSOR}" \
      --data-urlencode "employerOnly=1" \
      --data-urlencode "activeOnly=0" \
      "${BASE_URL}/importInseeDepartmentEstablishmentsHttp")"

    echo "$RESPONSE" > "${LOG_DIR}/${DEP}-page-${PAGE}.json"

    OK="$(echo "$RESPONSE" | jq -r '.ok')"

    if [ "$OK" != "true" ]; then
      STATUS="$(echo "$RESPONSE" | jq -r '.status // empty')"

      if [ "$STATUS" = "429" ]; then
        echo "Rate limit INSEE sur ${DEP}, page ${PAGE}. Pause 75 secondes puis reprise..."
        sleep 75
        PAGE=$((PAGE - 1))
        continue
      fi

      echo "$RESPONSE" | jq
      echo "Erreur import ${DEP}, page ${PAGE}"
      exit 1
    fi

    RECEIVED="$(echo "$RESPONSE" | jq -r '.receivedCount // 0')"
    KEPT="$(echo "$RESPONSE" | jq -r '.keptCount // 0')"
    WRITTEN="$(echo "$RESPONSE" | jq -r '.writtenCount // 0')"
    COMPLETE="$(echo "$RESPONSE" | jq -r '.complete')"
    NEXT_CURSOR="$(echo "$RESPONSE" | jq -r '.nextCursor // ""')"
    UNKNOWN_NAF="$(echo "$RESPONSE" | jq -r '.nafCounter.UNKNOWN // 0')"

    TOTAL_RECEIVED=$((TOTAL_RECEIVED + RECEIVED))
    TOTAL_KEPT=$((TOTAL_KEPT + KEPT))
    TOTAL_WRITTEN=$((TOTAL_WRITTEN + WRITTEN))

    echo "Dep ${DEP} | page ${PAGE} | recus=${RECEIVED} | gardes=${KEPT} | ecrits=${WRITTEN} | UNKNOWN_NAF=${UNKNOWN_NAF} | total=${TOTAL_WRITTEN} | complete=${COMPLETE}"

    if [ "$COMPLETE" = "true" ] || [ -z "$NEXT_CURSOR" ] || [ "$RECEIVED" = "0" ]; then
      echo "Import termine ${DEP} | recus=${TOTAL_RECEIVED} | gardes=${TOTAL_KEPT} | ecrits=${TOTAL_WRITTEN}"
      break
    fi

    CURSOR="$NEXT_CURSOR"
    sleep 2.2
  done

  echo
  echo "===== AGREGATION SECTEURS ${DEP} ====="
  curl -sS \
    -H "x-admin-key: ${ADMIN_KEY}" \
    "${BASE_URL}/buildInseeDepartmentStatsLightHttp?department=${DEP}&write=1" \
    | tee "${LOG_DIR}/${DEP}-sector-stats.json" \
    | jq '{ok, departmentCode, scannedCount, totals, sectorsCount, topSectors}'

  echo
  echo "===== AGREGATION NAF ${DEP} ====="
  curl -sS \
    -H "x-admin-key: ${ADMIN_KEY}" \
    "${BASE_URL}/buildInseeDepartmentNafStatsHttp?department=${DEP}&write=1" \
    | tee "${LOG_DIR}/${DEP}-naf-stats.json" \
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

  sleep 3
}

for DEP in 2A 2B 21 22 23 24 25 26 27 28 29 30
do
  import_department "$DEP"
done

echo
echo "IMPORT 2A 2B ET 21 A 30 TERMINE"
echo "Logs : ${LOG_DIR}"
