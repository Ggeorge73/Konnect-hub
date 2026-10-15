#!/usr/bin/env bash
# KH-47 SEC-03: fails when a server-only secret's name or value reaches the browser bundles.
# Run after `npm run build`. Checks .next/static (every file the browser can download).
#
#   bash scripts/check-bundle-secrets.sh [build-dir]
#
# 1. Names: no client chunk may even mention a server-only variable. If one does, a client
#    component imports server code (or reads process.env) and the value may follow next build.
# 2. Values: when the variables are set in the environment (CI sets dummy values for the build),
#    their values must not appear either.
set -euo pipefail

DIR="${1:-.next}/static"
if [ ! -d "$DIR" ]; then
  echo "check-bundle-secrets: $DIR not found; run npm run build first." >&2
  exit 2
fi

NAMES=(RESEND_API_KEY ANTHROPIC_API_KEY SUPABASE_SERVICE_ROLE_KEY SERVICE_ROLE DATABASE_URL REAUTH_SECRET ICS_SECRET CRON_SECRET KONNECTOR_INTEGRATION_SECRET)
# The broader stems the review asked for, matched as whole tokens so e.g. a "Resend" UI string is fine.
STEMS=(RESEND ANTHROPIC SERVICE_ROLE DATABASE_URL REAUTH_SECRET ICS_SECRET CRON_SECRET INTEGRATION_SECRET)

fail=0
mapfile -t TOKENS < <(printf '%s\n' "${NAMES[@]}" "${STEMS[@]}" | sort -u)
for n in "${TOKENS[@]}"; do
  if hits=$(grep -rlw --include='*.js' --include='*.css' --include='*.json' --include='*.html' -e "$n" "$DIR" 2>/dev/null); then
    echo "LEAK (name): $n appears in:" >&2
    echo "$hits" | sed 's/^/  /' >&2
    fail=1
  fi
done

for n in "${NAMES[@]}"; do
  v="${!n:-}"
  # Only meaningful values: skip unset and very short ones that could match by chance.
  if [ "${#v}" -ge 12 ] && grep -rlF -- "$v" "$DIR" >/dev/null 2>&1; then
    echo "LEAK (value): the value of $n appears in $DIR" >&2
    fail=1
  fi
done

if [ "$fail" -ne 0 ]; then
  echo "check-bundle-secrets: FAIL" >&2
  exit 1
fi
echo "check-bundle-secrets: PASS ($(find "$DIR" -type f | wc -l | tr -d ' ') files, ${#NAMES[@]} secrets checked)"
