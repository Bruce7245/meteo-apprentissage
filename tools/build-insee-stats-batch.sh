#!/usr/bin/env bash
set -euo pipefail

START="${1:-1}"
LIMIT="${2:-3}"

API_ROOT="https://europe-west1-meteo-apprentissage.cloudfunctions.net"
ADMIN_KEY="$(cat ~/apprentifr/.backfill_admin_key.local)"

mkdir -p logs

RUN_ID="$(date +%Y%m%d-%H%M%S)"
LOG_FILE="logs/insee-stats-batch-${START}-${LIMIT}-${RUN_ID}.log"

echo "===== RECUPERATION DEPARTEMENTS =====" | tee -a "${LOG_FILE}"
echo "Offset : ${START}" | tee -a "${LOG_FILE}"
echo "Limit  : ${LIMIT}" | tee -a "${LOG_FILE}"

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

TOTAL_SCANNED=0
TOTAL_ACTIVE_EMPLOYERS=0

for DEP in "${DEPARTMENTS[@]}"; do
  echo | tee -a "${LOG_FILE}"
  echo "===== AGREGATION INSEE ${DEP} =====" | tee -a "${LOG_FILE}"

  RESPONSE="$(curl -sS \
    -H "x-admin-key: ${ADMIN_KEY}" \
    "${API_ROOT}/buildInseeDepartmentStatsLightHttp?department=${DEP}&write=1")"

  echo "${RESPONSE}" | jq '{
    ok,
    departmentCode,
    scannedCount,
    activeEmployerEstablishmentsCount: .totals.activeEmployerEstablishmentsCount,
    sectorsCount,
    nafCodesCount,
    topSectors: .topSectors[0:5]
  }' | tee -a "${LOG_FILE}"

  OK="$(echo "${RESPONSE}" | jq -r '.ok // false')"

  if [ "${OK}" != "true" ]; then
    echo "ERREUR aggregation INSEE ${DEP}" | tee -a "${LOG_FILE}"
    continue
  fi

  SCANNED="$(echo "${RESPONSE}" | jq -r '.scannedCount // 0')"
  ACTIVE="$(echo "${RESPONSE}" | jq -r '.totals.activeEmployerEstablishmentsCount // 0')"

  TOTAL_SCANNED=$((TOTAL_SCANNED + SCANNED))
  TOTAL_ACTIVE_EMPLOYERS=$((TOTAL_ACTIVE_EMPLOYERS + ACTIVE))

  sleep 0.2
done

echo | tee -a "${LOG_FILE}"
echo "===== BILAN AGREGATION INSEE =====" | tee -a "${LOG_FILE}"
echo "Departements traites      : ${#DEPARTMENTS[@]}" | tee -a "${LOG_FILE}"
echo "Documents scannes         : ${TOTAL_SCANNED}" | tee -a "${LOG_FILE}"
echo "Actifs employeurs total   : ${TOTAL_ACTIVE_EMPLOYERS}" | tee -a "${LOG_FILE}"
echo "Log                       : ${LOG_FILE}" | tee -a "${LOG_FILE}"
