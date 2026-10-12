#!/usr/bin/env bash
# Applies auth-stub + migrations + seed + RLS tests to a throwaway database.
#
#   DATABASE_URL set   -> creates database kh_test_<pid> on that server (needs a superuser,
#                         e.g. the postgres:16 service container in GitHub Actions), drops it after.
#   DATABASE_URL unset -> initdb a temporary cluster (PG_BIN, default /usr/lib/postgresql/16/bin)
#                         on port ${KH_PG_PORT:-54329}, unix socket in the temp dir, removed after.
#                         initdb refuses to run as root, so as root the server runs as the
#                         `postgres` OS user (runuser/su); psql still runs as the caller.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUPA="$(cd "$HERE/.." && pwd)"
PG_BIN="${PG_BIN:-/usr/lib/postgresql/16/bin}"
PORT="${KH_PG_PORT:-54329}"
TMP=""
ADMIN_URL=""
TEST_URL=""
DB_NAME="kh_test_$$"

as_pg_owner() {
  if [ "$(id -u)" -eq 0 ]; then
    if command -v runuser >/dev/null 2>&1; then runuser -u postgres -- "$@"
    else su postgres -s /bin/bash -c "$(printf '%q ' "$@")"; fi
  else
    "$@"
  fi
}

cleanup() {
  local code=$?
  if [ -n "$ADMIN_URL" ] && [ -n "${DATABASE_URL:-}" ]; then
    psql "$ADMIN_URL" -q -v ON_ERROR_STOP=0 -c "drop database if exists $DB_NAME with (force)" >/dev/null 2>&1 || true
  fi
  if [ -n "$TMP" ]; then
    as_pg_owner "$PG_BIN/pg_ctl" -D "$TMP/data" -m immediate stop >/dev/null 2>&1 || true
    rm -rf "$TMP"
  fi
  if [ $code -eq 0 ]; then echo "PASS"; else echo "FAIL"; fi
  exit $code
}
trap cleanup EXIT

if [ -n "${DATABASE_URL:-}" ]; then
  ADMIN_URL="$DATABASE_URL"
  psql "$ADMIN_URL" -q -v ON_ERROR_STOP=1 -c "create database $DB_NAME"
  # Swap the database name in the URL (postgres://user:pw@host:port/db?params).
  TEST_URL="$(printf '%s' "$DATABASE_URL" | sed -E "s#^(postgres(ql)?://[^/?]+)(/[^?]*)?#\1/$DB_NAME#")"
else
  if [ ! -x "$PG_BIN/initdb" ]; then
    echo "initdb not found in $PG_BIN (set PG_BIN or DATABASE_URL)" >&2; exit 1
  fi
  if [ "$(id -u)" -eq 0 ] && ! id postgres >/dev/null 2>&1; then
    echo "Running as root needs an OS user 'postgres' (initdb refuses root). Create one or set DATABASE_URL." >&2
    exit 1
  fi
  TMP="$(mktemp -d)"
  chmod 755 "$TMP"
  [ "$(id -u)" -eq 0 ] && chown postgres "$TMP"
  as_pg_owner "$PG_BIN/initdb" -D "$TMP/data" -U postgres -A trust --no-sync >/dev/null
  as_pg_owner "$PG_BIN/pg_ctl" -D "$TMP/data" -l "$TMP/pg.log" -w \
    -o "-p $PORT -k $TMP -c listen_addresses='' -c fsync=off" start >/dev/null
  ADMIN_URL="postgresql://postgres@/postgres?host=$TMP&port=$PORT"
  TEST_URL="$ADMIN_URL"
fi

run() {
  echo "-- applying ${1#$SUPA/}"
  psql "$TEST_URL" -X -q -v ON_ERROR_STOP=1 --no-psqlrc -f - < "$1"
}

run "$HERE/auth-stub.sql"
for f in "$SUPA"/migrations/*.sql; do run "$f"; done
run "$SUPA/seed.sql"
run "$HERE/rls.test.sql"
