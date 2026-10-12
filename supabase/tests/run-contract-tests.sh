#!/usr/bin/env bash
# Runs the Repo contract suite (lib/data/contract.ts) against the Postgres repo
# (lib/data/postgres.ts) on a throwaway database with auth-stub + migrations + seed applied.
# See lib.sh: uses DATABASE_URL (a superuser) when set, otherwise a temporary local Postgres 16.
# The test clones the seeded database (CREATE DATABASE ... TEMPLATE) before every scenario,
# so the connecting role needs CREATEDB and must be able to `set role authenticated`.
set -euo pipefail

# shellcheck source=supabase/tests/lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

kh_db_start
kh_db_create "kh_contract_$$"
kh_db_load_all

cd "$KH_SUPA_DIR/.."
echo "-- running lib/data/postgres.test.ts"
TEST_DATABASE_URL="$TEST_URL" npx vitest run lib/data/postgres.test.ts "$@"
