#!/usr/bin/env bash
# Applies auth-stub + migrations + seed + RLS tests to a throwaway database.
# See lib.sh: uses DATABASE_URL (a superuser) when set, otherwise a temporary local Postgres 16.
set -euo pipefail

# shellcheck source=supabase/tests/lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

kh_db_start
kh_db_create "kh_test_$$"
kh_db_load_all
kh_db_apply "$KH_TESTS_DIR/rls.test.sql"
