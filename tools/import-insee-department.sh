#!/usr/bin/env bash
set -euo pipefail

DEP="${1:-01}"
NOMBRE="${2:-500}"
EMPLOYER_ONLY="${3:-1}"

API_ROOT="https://europe-west1-meteo-apprentissage.cloudfunctions.net"
ADMIN_KEY="$(cat ~/apprentifr/.backfill_admin_key.local)"

CURSOR="*"
PAGE=0
TOTAL_RECEIVED=0
MAX_PAGES=500

echo "===== IMPORT INSEE DEPARTEMENT ${DEP} ====="
echo "Nombre       : ${NOMBRE}"
echo "Employeurs   : ${EMPLOYER_ONLY}"
echo

while true; do
  echo "----- ${DEP} page curseur ${PAGE} -----"

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
    sample: (.sample[0:2] // [])
  }'

  OK="$(echo "${RESPONSE}" | jq -r '.ok // false')"

  if [ "${OK}" != "true" ]; then
    echo "ERREUR import INSEE ${DEP}"
    echo "${RESPONSE}" | jq .
    exit 1
  fi

  RECEIVED="$(echo "${RESPONSE}" | jq -r '.receivedCount // 0')"
  COMPLETE="$(echo "${RESPONSE}" | jq -r '.complete // false')"
  NEXT_CURSOR="$(echo "${RESPONSE}" | jq -r '.nextCursor // empty')"

  TOTAL_RECEIVED=$((TOTAL_RECEIVED + RECEIVED))

  if [ "${COMPLETE}" = "true" ]; then
    echo
    echo "Import complet pour ${DEP}."
    break
  fi

  if [ -z "${NEXT_CURSOR}" ]; then
    echo
    echo "Arret : nextCursor absent."
    break
  fi

  if [ "${RECEIVED}" -eq 0 ]; then
    echo
    echo "Arret : receivedCount = 0."
    break
  fi

  PAGE=$((PAGE + 1))

  if [ "${PAGE}" -ge "${MAX_PAGES}" ]; then
    echo "Arret de securite : MAX_PAGES atteint."
    exit 1
  fi

  CURSOR="${NEXT_CURSOR}"

  sleep 0.2
done

echo
echo "===== BILAN IMPORT INSEE ${DEP} ====="
echo "Pages traitees      : $((PAGE + 1))"
echo "Documents recus     : ${TOTAL_RECEIVED}"
echo "Departement         : ${DEP}"
