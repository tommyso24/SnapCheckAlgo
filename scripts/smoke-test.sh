#!/usr/bin/env bash
# SnapCheckAlgo end-to-end smoke test.
#
# Usage:
#   export SNAPCHECK_SERVICE_API_KEY="..."
#   bash scripts/smoke-test.sh
#
# Optional env:
#   SNAPCHECK_BASE_URL (default https://snap-check-algo.vercel.app)
#
# Exit codes:
#   0 - all 5 tests passed
#   1 - one or more tests failed
#   2 - environment problem (missing key / missing jq)

set -u

# ─── Colors (only when stdout is a TTY) ──────────────────────────────────
if [ -t 1 ]; then
  GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; DIM='\033[2m'; NC='\033[0m'
else
  GREEN=''; RED=''; YELLOW=''; DIM=''; NC=''
fi

TARGET="${SNAPCHECK_BASE_URL:-https://snap-check-algo.vercel.app}"

# ─── Environment sanity ──────────────────────────────────────────────────
if [ -z "${SNAPCHECK_SERVICE_API_KEY:-}" ]; then
  printf "%bERROR%b: SNAPCHECK_SERVICE_API_KEY not set.\n" "$RED" "$NC"
  printf "  export SNAPCHECK_SERVICE_API_KEY=\"your-key\"\n"
  exit 2
fi

if ! command -v jq >/dev/null 2>&1; then
  printf "%bERROR%b: jq is required but not installed.\n" "$RED" "$NC"
  printf "  macOS:  brew install jq\n"
  printf "  Ubuntu: sudo apt-get install jq\n"
  exit 2
fi

if ! command -v curl >/dev/null 2>&1; then
  printf "%bERROR%b: curl is required but not found.\n" "$RED" "$NC"
  exit 2
fi

# perl is on mac/linux by default — use it for ms-precision time
now_ms() {
  perl -MTime::HiRes=time -e 'printf("%d", time()*1000)'
}

fmt_seconds() {
  # Arg: milliseconds integer. Output: "X.Ys"
  awk "BEGIN { printf \"%.1fs\", $1/1000 }"
}

# ─── Header ──────────────────────────────────────────────────────────────
echo "SnapCheckAlgo Smoke Test"
echo "========================"
echo "Target: $TARGET"
echo "Time: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo

# ─── Running state ───────────────────────────────────────────────────────
PASS=0
FAIL=0
TOTAL_MS=0
SUITE_START=$(now_ms)

test_start() {
  # $1 = "X/5" label, $2 = description
  printf "[%s] %-35s " "$1" "$2"
}

test_pass() {
  # $1 = duration_ms
  printf "%bPASS%b (%s)\n" "$GREEN" "$NC" "$(fmt_seconds "$1")"
  PASS=$((PASS + 1))
  TOTAL_MS=$((TOTAL_MS + $1))
}

test_fail() {
  # $1 = duration_ms, $2 = expected, $3 = got
  printf "%bFAIL%b (%s)\n" "$RED" "$NC" "$(fmt_seconds "$1")"
  printf "  Expected: %s\n" "$2"
  printf "  Got:      %s\n" "$3"
  FAIL=$((FAIL + 1))
  TOTAL_MS=$((TOTAL_MS + $1))
}

# Sample inquiry used for tests 4 and 5 (deliberately lots of red flags
# so the main LLM produces a realistic report with non-null scores)
SAMPLE_INQUIRY='Hello, my name is Sarah Okafor from Lagos Trading Partners. We are an electronics distributor based in Nigeria, serving retail chains across West Africa since 2015. We are interested in your LED display products for a bulk purchase of 5,000 units. Please send CIF Lagos pricing, product catalogs, and specifications. Payment preferred via Western Union with 40% deposit. Visit our site at lagostradingpartners.example. Contact: sarah.okafor@gmail.com, +234-803-555-0101. Urgent order, need reply ASAP.'

SAMPLE_COMPANY='{
  "name": "Shenzhen Bright LED Co., Ltd.",
  "website": "https://mmldigi.com",
  "intro": "LED display manufacturer",
  "industry": "LED Display Manufacturing",
  "product_lines": ["Outdoor LED", "Indoor rental LED"]
}'

# ─── Test 1: Health check ────────────────────────────────────────────────
test_start "1/5" "Health check"
START=$(now_ms)
HTTP=$(curl -sS -o /dev/null -w "%{http_code}" "$TARGET/" --max-time 10 || echo "000")
MS=$(($(now_ms) - START))
case "$HTTP" in
  200|301|302|307|308) test_pass "$MS" ;;
  *) test_fail "$MS" "HTTP 200/307" "HTTP $HTTP" ;;
esac

# ─── Test 2: Auth rejection ──────────────────────────────────────────────
test_start "2/5" "Auth rejection"
START=$(now_ms)
HTTP=$(curl -sS -o /dev/null -w "%{http_code}" \
  -X POST "$TARGET/api/v1/analyze" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer not-a-real-key-xxxx" \
  --max-time 10 \
  -d '{"inquiry":"probe"}' || echo "000")
MS=$(($(now_ms) - START))
if [ "$HTTP" = "401" ]; then
  test_pass "$MS"
else
  test_fail "$MS" "HTTP 401" "HTTP $HTTP"
fi

# ─── Test 3: Empty input validation ──────────────────────────────────────
test_start "3/5" "Empty input validation"
START=$(now_ms)
RESP_FILE=$(mktemp)
HTTP=$(curl -sS -o "$RESP_FILE" -w "%{http_code}" \
  -X POST "$TARGET/api/v1/analyze" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $SNAPCHECK_SERVICE_API_KEY" \
  --max-time 10 \
  -d '{"inquiry":""}' || echo "000")
MS=$(($(now_ms) - START))
if [ "$HTTP" = "400" ]; then
  test_pass "$MS"
else
  BODY=$(head -c 500 "$RESP_FILE" 2>/dev/null)
  test_fail "$MS" "HTTP 400" "HTTP $HTTP, body: $BODY"
fi
rm -f "$RESP_FILE"

# ─── Helpers for SSE-based tests 4 & 5 ───────────────────────────────────
# Extract the done event's data JSON from an SSE dump.
# Uses awk to find the data line immediately after `event: done`.
extract_done_json() {
  awk '/^event: done/ {f=1; next} f && /^data: / { sub(/^data: /, ""); print; exit }' "$1"
}
extract_error_json() {
  awk '/^event: error/ {f=1; next} f && /^data: / { sub(/^data: /, ""); print; exit }' "$1"
}

# First progress event's elapsed_ms (or empty)
first_progress_ms() {
  awk '/^event: progress/ {f=1; next} f && /^data: / { sub(/^data: /, ""); print; exit }' "$1" \
    | jq -r '.elapsed_ms // empty' 2>/dev/null
}

# Max progress elapsed_ms across all progress events
max_progress_ms() {
  awk '/^event: progress/ {f=1; next} f && /^data: / { sub(/^data: /, ""); print; f=0 }' "$1" \
    | jq -s '[.[].elapsed_ms // 0] | max // 0' 2>/dev/null
}

# Build a request body
build_body() {
  # $1 = enable_intel (true/false)
  jq -cn --arg inquiry "$SAMPLE_INQUIRY" \
         --argjson company "$SAMPLE_COMPANY" \
         --argjson enable_intel "$1" \
         '{inquiry: $inquiry, company: $company, options: {enable_intel: $enable_intel}}'
}

# ─── Test 4: Offline mode end-to-end ─────────────────────────────────────
test_start "4/5" "Offline mode end-to-end"
SSE_FILE=$(mktemp)
BODY=$(build_body false)
START=$(now_ms)
STATS=$(curl -N -sS -X POST "$TARGET/api/v1/analyze" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $SNAPCHECK_SERVICE_API_KEY" \
  -H "Accept: text/event-stream" \
  --max-time 60 \
  -o "$SSE_FILE" \
  -w "%{http_code}|%{time_starttransfer}|%{time_total}" \
  -d "$BODY" 2>/dev/null || echo "000|0|0")
MS=$(($(now_ms) - START))
HTTP=$(echo "$STATS" | cut -d'|' -f1)
TTFB=$(echo "$STATS" | cut -d'|' -f2)
TOTAL=$(echo "$STATS" | cut -d'|' -f3)

if [ "$HTTP" != "200" ]; then
  BODY_SNIP=$(head -c 500 "$SSE_FILE" 2>/dev/null)
  test_fail "$MS" "HTTP 200" "HTTP $HTTP, body: $BODY_SNIP"
else
  DONE_JSON=$(extract_done_json "$SSE_FILE")
  ERR_JSON=$(extract_error_json "$SSE_FILE")

  if [ -n "$ERR_JSON" ]; then
    test_fail "$MS" "done event" "error event: $ERR_JSON"
  elif [ -z "$DONE_JSON" ]; then
    LAST_PROG=$(awk '/^event: progress/ {f=1; next} f && /^data: / { sub(/^data: /, ""); last=$0 } END { print last }' "$SSE_FILE")
    test_fail "$MS" "done event" "no done event; last progress: $LAST_PROG"
  else
    FIRST_MS=$(first_progress_ms "$SSE_FILE")
    RISK=$(echo "$DONE_JSON" | jq -r '.data.risk_level // empty')
    SCORES_NN=$(echo "$DONE_JSON" | jq '[.data.scores | to_entries[] | select(.value != null)] | length')
    MODEL=$(echo "$DONE_JSON" | jq -r '.data.model // empty')
    TOKENS_PRESENT=$(echo "$DONE_JSON" | jq -r '.data.tokens != null')

    REASONS=""
    if [ -z "$FIRST_MS" ] || [ "$FIRST_MS" -ge 10000 ] 2>/dev/null; then
      REASONS="${REASONS}first_progress=${FIRST_MS:-none}ms(need<10000); "
    fi
    if ! echo "$RISK" | grep -qE '^(low|medium|high)$'; then
      REASONS="${REASONS}risk_level=$RISK(need low|medium|high); "
    fi
    if [ "${SCORES_NN:-0}" -lt 3 ] 2>/dev/null; then
      REASONS="${REASONS}scores_non_null=${SCORES_NN}(need>=3); "
    fi
    if [ -z "$MODEL" ]; then
      REASONS="${REASONS}model=empty; "
    fi
    if [ "$TOKENS_PRESENT" != "true" ]; then
      REASONS="${REASONS}tokens=null; "
    fi
    TOTAL_INT=$(printf "%.0f" "$TOTAL" 2>/dev/null || echo "999")
    if [ "$TOTAL_INT" -ge 60 ]; then
      REASONS="${REASONS}total=${TOTAL_INT}s(need<60); "
    fi

    if [ -z "$REASONS" ]; then
      test_pass "$MS"
    else
      test_fail "$MS" "all checks pass" "$REASONS"
    fi
  fi
fi
rm -f "$SSE_FILE"

# ─── Test 5: Online mode end-to-end ──────────────────────────────────────
test_start "5/5" "Online mode end-to-end"
SSE_FILE=$(mktemp)
BODY=$(build_body true)
START=$(now_ms)
STATS=$(curl -N -sS -X POST "$TARGET/api/v1/analyze" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $SNAPCHECK_SERVICE_API_KEY" \
  -H "Accept: text/event-stream" \
  --max-time 180 \
  -o "$SSE_FILE" \
  -w "%{http_code}|%{time_starttransfer}|%{time_total}" \
  -d "$BODY" 2>/dev/null || echo "000|0|0")
MS=$(($(now_ms) - START))
HTTP=$(echo "$STATS" | cut -d'|' -f1)
TTFB=$(echo "$STATS" | cut -d'|' -f2)
TOTAL=$(echo "$STATS" | cut -d'|' -f3)

if [ "$HTTP" != "200" ]; then
  BODY_SNIP=$(head -c 500 "$SSE_FILE" 2>/dev/null)
  test_fail "$MS" "HTTP 200" "HTTP $HTTP, body: $BODY_SNIP"
else
  DONE_JSON=$(extract_done_json "$SSE_FILE")
  ERR_JSON=$(extract_error_json "$SSE_FILE")

  if [ -n "$ERR_JSON" ]; then
    test_fail "$MS" "done event" "error event: $ERR_JSON"
  elif [ -z "$DONE_JSON" ]; then
    LAST_PROG=$(awk '/^event: progress/ {f=1; next} f && /^data: / { sub(/^data: /, ""); last=$0 } END { print last }' "$SSE_FILE")
    test_fail "$MS" "done event" "no done event; last progress: $LAST_PROG"
  else
    FIRST_MS=$(first_progress_ms "$SSE_FILE")
    MAX_MS=$(max_progress_ms "$SSE_FILE")
    SUBKEY_CHECK=$(echo "$DONE_JSON" | jq '
      (.data.intel // null) as $i |
      if $i == null then false
      else
        ($i.website != null) and ($i.wayback != null) and
        ($i.linkedin != null) and ($i.facebook != null) and
        ($i.panjiva != null) and ($i.negative != null) and
        ($i.generalSearch != null) and ($i.phone != null) and
        ($i.meta != null)
      end
    ')

    REASONS=""
    if [ -z "$FIRST_MS" ] || [ "$FIRST_MS" -ge 10000 ] 2>/dev/null; then
      REASONS="${REASONS}first_progress=${FIRST_MS:-none}ms(need<10000); "
    fi
    # Proof we crossed the 60s proxy boundary: at least one progress
    # event must have elapsed_ms >= 60000 (unless the whole request
    # completed in <60s, in which case no crossing was needed)
    TOTAL_INT=$(printf "%.0f" "$TOTAL" 2>/dev/null || echo "0")
    if [ "$TOTAL_INT" -ge 60 ] && [ "${MAX_MS:-0}" -lt 60000 ] 2>/dev/null; then
      REASONS="${REASONS}no progress after 60s crossing(max=${MAX_MS}ms); "
    fi
    if [ "$SUBKEY_CHECK" != "true" ]; then
      REASONS="${REASONS}intel subkeys incomplete; "
    fi
    if [ "$TOTAL_INT" -ge 180 ]; then
      REASONS="${REASONS}total=${TOTAL_INT}s(need<180); "
    fi

    if [ -z "$REASONS" ]; then
      test_pass "$MS"
    else
      test_fail "$MS" "all checks pass" "$REASONS"
    fi
  fi
fi
rm -f "$SSE_FILE"

# ─── Summary ─────────────────────────────────────────────────────────────
echo
echo "========================"
SUITE_MS=$(($(now_ms) - SUITE_START))
if [ "$FAIL" -eq 0 ]; then
  printf "Result: %b%d/5 PASSED%b\n" "$GREEN" "$PASS" "$NC"
else
  printf "Result: %b%d/5 passed, %d failed%b\n" "$RED" "$PASS" "$FAIL" "$NC"
fi
printf "Total: %s\n" "$(fmt_seconds "$SUITE_MS")"

[ "$FAIL" -eq 0 ] && exit 0 || exit 1
