#!/usr/bin/env bash
set -euo pipefail

START="${1:-0}"
LIMIT="${2:-3}"

API_ROOT="https://europe-west1-meteo-apprentissage.cloudfunctions.net"
ADMIN_KEY="$(cat ~/apprentifr/.backfill_admin_key.local)"

echo "===== RECUPERATION DEPARTEMENTS ====="
echo "Offset: ${START}"
echo "Limit : ${LIMIT}"

DEPARTMENTS_JSON="$(curl -sS \
  -H "x-admin-key: ${ADMIN_KEY}" \
  "${API_ROOT}/seedDepartmentsFromGeoApi?limit=120&offset=0&write=0")"

echo "${DEPARTMENTS_JSON}" | jq -e '.ok == true' >/dev/null

mapfile -t DEPARTMENTS < <(
  echo "${DEPARTMENTS_JSON}" | jq -c \
    --argjson start "${START}" \
    --argjson limit "${LIMIT}" \
    '.rows[$start:($start + $limit)][] | {
      code: .departmentCode,
      name: .name,
      latitude: .formationSearch.latitude,
      longitude: .formationSearch.longitude,
      radiusKm: .formationSearch.radiusKm
    }'
)

echo "Departements selectionnes: ${#DEPARTMENTS[@]}"
echo

TOTAL_WRITTEN=0
TOTAL_RECEIVED=0
TOTAL_SKIPPED=0

for department in "${DEPARTMENTS[@]}"; do
  CODE="$(echo "${department}" | jq -r '.code')"
  NAME="$(echo "${department}" | jq -r '.name')"
  LATITUDE="$(echo "${department}" | jq -r '.latitude')"
  LONGITUDE="$(echo "${department}" | jq -r '.longitude')"
  RADIUS="$(echo "${department}" | jq -r '.radiusKm')"

  echo
  echo "===== FORMATIONS ${CODE} - ${NAME} ====="
  echo "Centre: ${LATITUDE}, ${LONGITUDE}"
  echo "Rayon : ${RADIUS} km"

  FIRST_RESPONSE="$(curl -sS \
    -H "x-admin-key: ${ADMIN_KEY}" \
    "${API_ROOT}/importLbaFormationsPage?department=${CODE}&latitude=${LATITUDE}&longitude=${LONGITUDE}&radius=${RADIUS}&page=0&pageIndex=0&write=1&filterDepartment=1")"

  echo "${FIRST_RESPONSE}" | jq .

  OK="$(echo "${FIRST_RESPONSE}" | jq -r '.ok // false')"

  if [ "${OK}" != "true" ]; then
    echo "ERREUR import page 0 pour ${CODE}"
    continue
  fi

  PAGE_COUNT="$(echo "${FIRST_RESPONSE}" | jq -r '.pageCount // .pagination.page_count // 1')"
  RECEIVED="$(echo "${FIRST_RESPONSE}" | jq -r '.receivedCount // 0')"
  WRITTEN="$(echo "${FIRST_RESPONSE}" | jq -r '.writtenCount // 0')"
  SKIPPED="$(echo "${FIRST_RESPONSE}" | jq -r '.skippedOutsideDepartment // 0')"

  TOTAL_RECEIVED=$((TOTAL_RECEIVED + RECEIVED))
  TOTAL_WRITTEN=$((TOTAL_WRITTEN + WRITTEN))
  TOTAL_SKIPPED=$((TOTAL_SKIPPED + SKIPPED))

  if [ "${PAGE_COUNT}" = "null" ] || [ -z "${PAGE_COUNT}" ]; then
    PAGE_COUNT=1
  fi

  echo "Pages detectees: ${PAGE_COUNT}"

  if [ "${PAGE_COUNT}" -gt 1 ]; then
    for (( PAGE=1; PAGE<PAGE_COUNT; PAGE++ )); do
      echo "----- ${CODE} page ${PAGE}/${PAGE_COUNT} -----"

      RESPONSE="$(curl -sS \
        -H "x-admin-key: ${ADMIN_KEY}" \
        "${API_ROOT}/importLbaFormationsPage?department=${CODE}&latitude=${LATITUDE}&longitude=${LONGITUDE}&radius=${RADIUS}&page=${PAGE}&pageIndex=${PAGE}&write=1&filterDepartment=1")"

      echo "${RESPONSE}" | jq '{ok, page, pageIndex, receivedCount, writtenCount, skippedOutsideDepartment, pageCount}'

      OK="$(echo "${RESPONSE}" | jq -r '.ok // false')"

      if [ "${OK}" != "true" ]; then
        echo "ERREUR import page ${PAGE} pour ${CODE}"
        break
      fi

      RECEIVED="$(echo "${RESPONSE}" | jq -r '.receivedCount // 0')"
      WRITTEN="$(echo "${RESPONSE}" | jq -r '.writtenCount // 0')"
      SKIPPED="$(echo "${RESPONSE}" | jq -r '.skippedOutsideDepartment // 0')"

      TOTAL_RECEIVED=$((TOTAL_RECEIVED + RECEIVED))
      TOTAL_WRITTEN=$((TOTAL_WRITTEN + WRITTEN))
      TOTAL_SKIPPED=$((TOTAL_SKIPPED + SKIPPED))

      sleep 0.2
    done
  fi
done

echo
echo "===== BILAN BATCH FORMATIONS ====="
echo "Departements traites : ${#DEPARTMENTS[@]}"
echo "Total recu          : ${TOTAL_RECEIVED}"
echo "Total ecrit         : ${TOTAL_WRITTEN}"
echo "Total hors dept     : ${TOTAL_SKIPPED}"
