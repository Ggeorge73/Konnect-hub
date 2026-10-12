#!/usr/bin/env bash
# Shared helpers for the database test scripts (run-rls-tests.sh, run-contract-tests.sh).
# Source it after `set -euo pipefail`. It defines the functions below and installs an EXIT trap
# that drops the databases it created, stops a temporary cluster and prints PASS / FAIL.
#
#   kh_db_start        DATABASE_URL set   -> uses that server (needs a superuser, e.g. the
#                                            postgres:16 service container in GitHub Actions).
#                      DATABASE_URL unset -> initdb a temporary cluster (PG_BIN, default
#                                            /usr/lib/postgresql/16/bin) on port ${KH_PG_PORT:-54329},
#                                            unix socket in the temp dir, removed on exit.
#                                            initdb refuses to run as root, so as root the server runs
#                                            as the `postgres` OS user (runuser/su); psql runs as the caller.
#                      Sets ADMIN_URL (a superuser connection).
#   kh_db_create NAME  creates database NAME (dropped on exit) and points TEST_URL at it.
#   kh_db_apply FILE   runs a SQL file against TEST_URL, stopping on the first error.
#   kh_db_load_all     auth stub + every migration + seed.sql into TEST_URL.

KH_TESTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KH_SUPA_DIR="$(cd "$KH_TESTS_DIR/.." && pwd)"
PG_BIN="${PG_BIN:-/usr/lib/postgresql/16/bin}"
KH_PG_PORT="${KH_PG_PORT:-54329}"
KH_TMP=""
ADMIN_URL=""
TEST_URL=""
KH_DBS=()

as_pg_owner() {
  if [ "$(id -u)" -eq 0 ]; then
    if command -v runuser >/dev/null 2>&1; then runuser -u postgres -- "$@"
    else su postgres -s /bin/bash -c "$(printf '%q ' "$@")"; fi
  else
    "$@"
  fi
}

# Swap the database name in a URL (postgres://user:pw@host:port/db?params).
kh_url_with_db() {
  printf '%s' "$1" | sed -E "s#^(postgres(ql)?://[^/?]*)(/[^?]*)?#\1/$2#"
}

kh_cleanup() {
  local code=$?
  if [ -n "$ADMIN_URL" ]; then
    for db in "${KH_DBS[@]}"; do
      psql "$ADMIN_URL" -X -q -v ON_ERROR_STOP=0 \
        -c "drop database if exists $db with (force)" >/dev/null 2>&1 || true
    done
  fi
  if [ -n "$KH_TMP" ]; then
    as_pg_owner "$PG_BIN/pg_ctl" -D "$KH_TMP/data" -m immediate stop >/dev/null 2>&1 || true
    rm -rf "$KH_TMP"
  fi
  if [ $code -eq 0 ]; then echo "PASS"; else echo "FAIL"; fi
  exit $code
}
trap kh_cleanup EXIT

kh_db_start() {
  if [ -n "${DATABASE_URL:-}" ]; then
    ADMIN_URL="$DATABASE_URL"
    return
  fi
  if [ ! -x "$PG_BIN/initdb" ]; then
    echo "initdb not found in $PG_BIN (set PG_BIN or DATABASE_URL)" >&2
    exit 1
  fi
  if [ "$(id -u)" -eq 0 ] && ! id postgres >/dev/null 2>&1; then
    echo "Running as root needs an OS user 'postgres' (initdb refuses root). Create one or set DATABASE_URL." >&2
    exit 1
  fi
  KH_TMP="$(mktemp -d)"
  chmod 755 "$KH_TMP"
  if [ "$(id -u)" -eq 0 ]; then chown postgres "$KH_TMP"; fi
  as_pg_owner "$PG_BIN/initdb" -D "$KH_TMP/data" -U postgres -A trust --no-sync >/dev/null
  as_pg_owner "$PG_BIN/pg_ctl" -D "$KH_TMP/data" -l "$KH_TMP/pg.log" -w \
    -o "-p $KH_PG_PORT -k $KH_TMP -c listen_addresses='' -c fsync=off" start >/dev/null
  ADMIN_URL="postgresql://postgres@/postgres?host=$KH_TMP&port=$KH_PG_PORT"
}

kh_db_create() {
  psql "$ADMIN_URL" -X -q -v ON_ERROR_STOP=1 -c "create database $1"
  KH_DBS+=("$1")
  TEST_URL="$(kh_url_with_db "$ADMIN_URL" "$1")"
}

kh_db_apply() {
  echo "-- applying ${1#"$KH_SUPA_DIR"/}"
  psql "$TEST_URL" -X -q -v ON_ERROR_STOP=1 --no-psqlrc -f - < "$1"
}

kh_db_load_all() {
  kh_db_apply "$KH_TESTS_DIR/auth-stub.sql"
  for f in "$KH_SUPA_DIR"/migrations/*.sql; do kh_db_apply "$f"; done
  kh_db_apply "$KH_SUPA_DIR/seed.sql"
}
