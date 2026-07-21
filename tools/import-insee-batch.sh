#!/usr/bin/env bash
set -euo pipefail

START="${1:-1}"
LIMIT="${2:-3}"
NOMBRE="${3:-500}"
EMPLOYER_ONLY="${4:-1}"

API_ROOT="https://europe-west1-meteo-apprentissage.cloudfunctions.net"
ADMIN_KEY="$(cat ~/apprentifr/.backfill_admin_key.local)"

mkdir -p logs

RUN_ID="$(date +%Y%m%d-%H%M%S)"
LOG_FILE="logs/insee-import-batch-${START}-${LIMIT}-${RUN_ID}.log"

echo "===== RECUPERATION DEPARTEMENTS =====" | tee -a "${LOG_FILE}"
echo "Offset       : ${START}" | tee -a "${LOG_FILE}"
echo "Limit        : ${LIMIT}" | tee -a "${LOG_FILE}"
echo "Nombre/page  : ${NOMBRE}" | tee -a "${LOG_FILE}"
echo "EmployerOnly : ${EMPLOYER_ONLY}" | tee -a "${LOG_FILE}"

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

echo "Departements selectionnes: ${#DEPARTMENTS[@]}" | tee -a "${LOG_FILE}"

TOTAL_RECEIVED_ALL=0

for DEP in "${DEPARTMENTS[@]}"; do
  echo | tee -a "${LOG_FILE}"
  echo "======================================" | tee -a "${LOG_FILE}"
  echo "IMPORT INSEE ${DEP}" | tee -a "${LOG_FILE}"
  echo "======================================" | tee -a "${LOG_FILE}"

  CURSOR="*"
  PAGE=0
  TOTAL_RECEIVED=0
  MAX_PAGES=800

  while true; do
    echo "----- ${DEP} page curseur ${PAGE} -----" | tee -a "${LOG_FILE}"

    RESPONSE="$(curl -sS -G \
      -H "x-admin-key: ${ADMIN_KEY}" \
      --data-urlencode "department=${DEP}" \
      --data-urlencode "nombre=${NOMBRE}" \
      --data-urlencode "employerOnly=${EMPLOYER_ONLY}" \
      --data-urlencode "write=1" \
      --data-urlencode "cursor=${CURSOR}" \
      "${API_ROOT}/importInseeDepartmentPage")"

    echo "${RESPONSE}" | jq '{
      ok,
      departmentCode,
      cursor,
      nextCursor,
      complete,
      receivedCount,
      sample: (.sample[0:1] // [])
    }' | tee -a "${LOG_FILE}"

    OK="$(echo "${RESPONSE}" | jq -r '.ok // false')"

    if [ "${OK}" != "true" ]; then
      echo "ERREUR import INSEE ${DEP}" | tee -a "${LOG_FILE}"
      echo "${RESPONSE}" | jq . | tee -a "${LOG_FILE}"
      break
    fi

    RECEIVED="$(echo "${RESPONSE}" | jq -r '.receivedCount // 0')"
    COMPLETE="$(echo "${RESPONSE}" | jq -r '.complete // false')"
    NEXT_CURSOR="$(echo "${RESPONSE}" | jq -r '.nextCursor // empty')"

    TOTAL_RECEIVED=$((TOTAL_RECEIVED + RECEIVED))
    TOTAL_RECEIVED_ALL=$((TOTAL_RECEIVED_ALL + RECEIVED))

    if [ "${COMPLETE}" = "true" ]; then
      echo "Import complet pour ${DEP}." | tee -a "${LOG_FILE}"
      break
    fi

    if [ -z "${NEXT_CURSOR}" ]; then
      echo "Arret ${DEP} : nextCursor absent." | tee -a "${LOG_FILE}"
      break
    fi

    if [ "${RECEIVED}" -eq 0 ]; then
      echo "Arret ${DEP} : receivedCount = 0." | tee -a "${LOG_FILE}"
      break
    fi

    PAGE=$((PAGE + 1))

    if [ "${PAGE}" -ge "${MAX_PAGES}" ]; then
      echo "Arret securite ${DEP} : MAX_PAGES atteint." | tee -a "${LOG_FILE}"
      break
    fi

    CURSOR="${NEXT_CURSOR}"
    sleep 0.2
  done

  echo "BILAN ${DEP} : pages=$((PAGE + 1)) recus=${TOTAL_RECEIVED}" | tee -a "${LOG_FILE}"
done

echo | tee -a "${LOG_FILE}"
echo "===== BILAN BATCH INSEE =====" | tee -a "${LOG_FILE}"
echo "Departements traites : ${#DEPARTMENTS[@]}" | tee -a "${LOG_FILE}"
echo "Documents recus      : ${TOTAL_RECEIVED_ALL}" | tee -a "${LOG_FILE}"
echo "Log                  : ${LOG_FILE}" | tee -a "${LOG_FILE}"
