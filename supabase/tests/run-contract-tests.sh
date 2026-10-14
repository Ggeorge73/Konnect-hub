#!/usr/bin/env bash
# Runs the Repo contract suite (lib/data/contract.ts) and the domain contract suites
# (lib/data/contract-domains.ts: RAID, sprints, gates, deliverables) and the capacity contract
# (lib/data/contract-capacity.ts, via capacity-postgres.test.ts) against the Postgres stores
# (lib/data/postgres.ts, lib/data/*-postgres.ts) on a throwaway database with auth-stub +
# migrations + seed applied. The same suites run against the demo store in memory.test.ts.
# See lib.sh: uses DATABASE_URL (a superuser) when set, otherwise a temporary local Postgres 16.
# The test clones the seeded database (CREATE DATABASE ... TEMPLATE) before every scenario,
# so the connecting role needs CREATEDB and must be able to `set role authenticated` and
# `set role service_role` (the system-wide stale-issue escalation runs as service_role).
set -euo pipefail

# shellcheck source=supabase/tests/lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

kh_db_start
kh_db_create "kh_contract_$$"
kh_db_load_all

cd "$KH_SUPA_DIR/.."
# Every Postgres-backed suite: lib/data/postgres.test.ts plus any lib/data/*-postgres.test.ts, so a
# new store's contract can't be left out of CI by forgetting to list it here.
PG_TESTS=(lib/data/postgres.test.ts lib/data/*-postgres.test.ts)
echo "-- running ${PG_TESTS[*]}"
TEST_DATABASE_URL="$TEST_URL" npx vitest run "${PG_TESTS[@]}" "$@"
