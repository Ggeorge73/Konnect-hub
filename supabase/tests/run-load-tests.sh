#!/usr/bin/env bash
# KH-46 [PERF-01]: loads the 2×-scale dataset (load.sql) into a throwaway database with auth-stub +
# migrations + seed applied, then runs the search / board query-plan and timing check
# (load-check.sql) with RLS on. See docs/performance.md.
#
#   bash supabase/tests/run-load-tests.sh                      # full 2× scale: 400k items, 120 projects
#   KH_LOAD_TOTAL=20000 KH_LOAD_BIG=5000 bash supabase/tests/run-load-tests.sh   # CI-sized
#
# Uses DATABASE_URL (a superuser) when set, otherwise a temporary local Postgres 16 (see lib.sh).
set -euo pipefail

# shellcheck source=supabase/tests/lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

PROJECTS="${KH_LOAD_PROJECTS:-120}"
BIG="${KH_LOAD_BIG:-20000}"
TOTAL="${KH_LOAD_TOTAL:-400000}"
MAX_MS="${KH_LOAD_MAX_MS:-500}"

kh_db_start
kh_db_create "kh_load_$$"
kh_db_load_all
echo "-- loading ${TOTAL} items in ${PROJECTS} projects (${BIG} in LOAD)"
psql "$TEST_URL" -X -q -v ON_ERROR_STOP=1 --no-psqlrc \
  -v projects="$PROJECTS" -v big_items="$BIG" -v items_total="$TOTAL" -f "$KH_TESTS_DIR/load.sql"
echo "-- checking search and board query plans (budget ${MAX_MS} ms)"
psql "$TEST_URL" -X -q -v ON_ERROR_STOP=1 --no-psqlrc -v max_ms="$MAX_MS" -f "$KH_TESTS_DIR/load-check.sql"
