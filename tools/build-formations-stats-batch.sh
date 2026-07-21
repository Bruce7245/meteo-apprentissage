#!/usr/bin/env bash
set -euo pipefail

START="${1:-0}"
LIMIT="${2:-3}"
DATE="${3:-2026-06-30}"
DEFAULT_CAPACITY="${4:-8}"

API_ROOT="https://europe-west1-meteo-apprentissage.cloudfunctions.net"
ADMIN_KEY="$(cat ~/apprentifr/.backfill_admin_key.local)"

echo "===== RECUPERATION DEPARTEMENTS ====="
echo "Offset          : ${START}"
echo "Limit           : ${LIMIT}"
echo "Date calcul     : ${DATE}"
echo "Capacite defaut : ${DEFAULT_CAPACITY}"

DEPARTMENTS_JSON="$(curl -sS \
  -H "x-admin-key: ${ADMIN_KEY}" \
  "${API_ROOT}/seedDepartmentsFromGeoApi?limit=120&offset=0&write=0")"

echo "${DEPARTMENTS_JSON}" | jq -e '.ok == true' >/dev/null

mapfile -t DEPARTMENTS < <(
  echo "${DEPARTMENTS_JSON}" | jq -r \
    --argjson start "${START}" \
    --argjson limit "${LIMIT}" \
    '.rows[$start:($start + $limit)][] | .departmentCode'
)

echo "Departements selectionnes: ${#DEPARTMENTS[@]}"
echo

TOTAL_SCANNED=0
TOTAL_FORMATIONS=0
TOTAL_NEED=0

for DEP in "${DEPARTMENTS[@]}"; do
  echo
  echo "===== AGREGATION FORMATIONS ${DEP} ====="

  RESPONSE="$(curl -sS \
    -H "x-admin-key: ${ADMIN_KEY}" \
    "${API_ROOT}/buildFormationDepartmentStatsHttp?department=${DEP}&date=${DATE}&defaultCapacity=${DEFAULT_CAPACITY}&write=1")"

  echo "${RESPONSE}" | jq '{ok, departmentCode, scannedCount, sectorsCount, formationsCount: .totals.formationsCount, sessionsCount: .totals.sessionsCount, estimatedNeedToSecure: .totals.estimatedNeedToSecure, topSectors: .topSectors[0:3]}'

  OK="$(echo "${RESPONSE}" | jq -r '.ok // false')"

  if [ "${OK}" != "true" ]; then
    echo "ERREUR aggregation ${DEP}"
    continue
  fi

  SCANNED="$(echo "${RESPONSE}" | jq -r '.scannedCount // 0')"
  FORMATIONS="$(echo "${RESPONSE}" | jq -r '.totals.formationsCount // 0')"
  NEED="$(echo "${RESPONSE}" | jq -r '.totals.estimatedNeedToSecure // 0')"

  TOTAL_SCANNED=$((TOTAL_SCANNED + SCANNED))
  TOTAL_FORMATIONS=$((TOTAL_FORMATIONS + FORMATIONS))
  TOTAL_NEED="$(awk "BEGIN {print ${TOTAL_NEED} + ${NEED}}")"

  sleep 0.2
done

echo
echo "===== BILAN AGREGATION FORMATIONS ====="
echo "Departements traites : ${#DEPARTMENTS[@]}"
echo "Documents scannes    : ${TOTAL_SCANNED}"
echo "Formations totales   : ${TOTAL_FORMATIONS}"
echo "Besoin pondere total : ${TOTAL_NEED}"
