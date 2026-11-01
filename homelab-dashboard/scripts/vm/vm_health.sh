#!/bin/bash
# Oracle VM health report. `--api` when run behind socat for the dashboard Worker,
# no args for the CLI view. Host-specific values live in env_files/vm_health.env next to this
# script (see env_files/vm_health.env.example).

: "${HOME:=$(getent passwd "$(id -un)" | cut -d: -f6)}"

# ---------------- CONFIG ----------------
SCRIPT_DIR=$(dirname "$(readlink -f "$0")")
CONFIG_FILE="${HEALTH_CONFIG:-$SCRIPT_DIR/env_files/vm_health.env}"
# shellcheck source=/dev/null
[[ -f "$CONFIG_FILE" ]] && source "$CONFIG_FILE"

WORKER_SECRET="${WORKER_SECRET:-}"   # empty = every --api request is rejected
PI_TUNNEL_IP="${PI_TUNNEL_IP:-}"
STEAL_ALERT_PCT="${STEAL_ALERT_PCT:-20}"
SERVICE_EXCLUDE="${SERVICE_EXCLUDE:-snap.oracle-cloud-agent|vm-health-api}"
ARM_GRAB_SUCCESS_LOG="${ARM_GRAB_SUCCESS_LOG:-$HOME/auto_arm_grab_success.log}"
CACHE_DIR="${CACHE_DIR:-$HOME/jellyfin_cache_hit}"

# ---------------- HTTP HELPERS ----------------
# printf '%s' instead of echo -e, so backslashes inside the JSON are never interpreted.
http_reply() {
    local status=$1 ctype=$2 body=$3
    printf 'HTTP/1.1 %s\r\nContent-Type: %s\r\nContent-Length: %s\r\nConnection: close\r\n\r\n%s' \
        "$status" "$ctype" "$(printf '%s' "$body" | wc -c)" "$body"
}

# ---------------- CONCURRENCY LOCK ----------------
exec 9>/tmp/vm_health.lock
if ! flock -w 5 9; then
    if [[ "$1" == "--api" ]]; then
        echo -e "\n=== SKIPPED CONCURRENT EXECUTION: $(date) ===" >> "$HOME/api-health.log"
        http_reply "429 Too Many Requests" "text/plain" "Concurrent execution skipped"
    else
        echo -e "\n=== SKIPPED CONCURRENT EXECUTION: $(date) ===" >> "$HOME/health.log"
        echo "Script is already running. Exiting."
    fi
    exit 0
fi

# ---------------- LOGGING CONFIG & DELETION ----------------
LOG_FILE="$HOME/health.log"

if [[ "$1" == "--api" ]]; then
    LOG_FILE="$HOME/api-health.log"
    VALID_SECRET="false"
    REQ_HEADERS=""
    CLIENT_IP="${SOCAT_PEERADDR:-Unknown}"

    # Read HTTP headers line by line (1 sec timeout to prevent hanging)
    while read -t 1 -r line; do
        line=${line%$'\r'}
        [[ -z "$line" ]] && break # Empty line means end of headers
        REQ_HEADERS+="$line | "
        if [[ -n "$WORKER_SECRET" && "${line,,}" == "x-worker-secret: ${WORKER_SECRET,,}" ]]; then
            VALID_SECRET="true"
        fi
    done

    # Reject if the secret header is missing
    if [[ "$VALID_SECRET" != "true" ]]; then
        echo -e "\n=== BLOCKED UNAUTHORIZED SCAN: $(date) ===" >> "$LOG_FILE"
        echo "Source IP: $CLIENT_IP | Headers: $REQ_HEADERS" >> "$LOG_FILE"
        http_reply "403 Forbidden" "text/plain" "Access Denied"
        exit 0
    fi
fi

if [[ -f "$LOG_FILE" ]]; then
    SIZE=$(stat -c%s "$LOG_FILE" 2>/dev/null)
    if [[ ${SIZE:-0} -ge 1048576 ]]; then
        TOTAL_LINES=$(wc -l < "$LOG_FILE")
        KEEP_LINES=$(( ${TOTAL_LINES:-0} * 80 / 100 ))
        tail -n "$KEEP_LINES" "$LOG_FILE" > "${LOG_FILE}.tmp" && mv "${LOG_FILE}.tmp" "$LOG_FILE"
    fi
fi

echo -e "\n=== RUN: $(date) ===" >> "$LOG_FILE"

# Colors for CLI
R="\033[31m"; G="\033[32m"; Y="\033[33m"; C="\033[36m"; W="\033[37m"; RST="\033[0m"

# ---------------- CPU STEAL ----------------
# Average steal since the previous run (/proc/stat delta). Sampling for a second
# while this script runs measures the script's own burst on these burstable
# shapes, not the host's contention. First run falls back to since-boot.
STEAL_STATE="/tmp/vm_health.cpustat"
read -r _ u n s i w q sq st _ < /proc/stat
CPU_TOT=$((u+n+s+i+w+q+sq+st)); CPU_ST=$st
PREV_TOT=0; PREV_ST=0
[[ -f "$STEAL_STATE" ]] && read -r PREV_TOT PREV_ST < "$STEAL_STATE"
[[ ${PREV_TOT:-0} -ge $CPU_TOT ]] && { PREV_TOT=0; PREV_ST=0; }  # rebooted since last run
echo "$CPU_TOT $CPU_ST" > "$STEAL_STATE"
STEAL=$(awk -v st=$((CPU_ST - PREV_ST)) -v t=$((CPU_TOT - PREV_TOT)) 'BEGIN { printf "%.1f", (t > 0 ? st * 100 / t : 0) }')

# ---------------- BACKGROUND PROBES ----------------
T=$(mktemp -d /tmp/vm_health.XXXXXX)
trap 'rm -rf "$T"' EXIT
(ping -c1 -W2 "$PI_TUNNEL_IP" >/dev/null 2>&1 && echo "REACHABLE" || echo "UNREACHABLE") > "$T/ping" &

# ---------------- CACHE PARSING (LIFETIME & DAILY) ----------------
TEMP_LOG="$CACHE_DIR/temp_hit_rate.log"
TOTAL_LOG="$CACHE_DIR/total_hit_rate.log"
DAILY_LOG="$CACHE_DIR/hit_rate.log"

# Ensure files exist
touch "$TOTAL_LOG" "$DAILY_LOG"

# Snapshot and truncate in one step so hits and misses come from the same
# contents and lines written between two separate greps aren't lost.
SNAPSHOT=$(sudo sh -c 'cat "$1" 2>/dev/null; : > "$1"' _ "$TEMP_LOG")
NEW_HITS=$(grep -c "HIT" <<< "$SNAPSHOT")
NEW_MISSES=$(grep -c "MISS" <<< "$SNAPSHOT")

N_H=${NEW_HITS:-0}; N_M=${NEW_MISSES:-0}

# 1. Update Lifetime (Logging Only)
CUR_TOT_HITS=$(awk '{if (tolower($1) ~ /^hits?:/) {print $2; exit}}' "$TOTAL_LOG" 2>/dev/null | tr -d '\r')
CUR_TOT_MISSES=$(awk '{if (tolower($1) ~ /^miss(es)?:/) {print $2; exit}}' "$TOTAL_LOG" 2>/dev/null | tr -d '\r')

TOT_HITS=$(( ${CUR_TOT_HITS:-0} + N_H ))
TOT_MISSES=$(( ${CUR_TOT_MISSES:-0} + N_M ))
echo -e "HITS: $TOT_HITS\nMISSES: $TOT_MISSES" > "$TOTAL_LOG"

# 2. Update Daily History & Prepare Display Variables
DATE_STR=$(date +%d-%b-%Y)
LAST_LINE=$(tail -n 1 "$DAILY_LOG" 2>/dev/null | tr -d '\r')

if [[ -n "$LAST_LINE" && "$LAST_LINE" == *"$DATE_STR"* ]]; then
    D_HITS_RAW=$(echo "$LAST_LINE" | awk '{print $1}' | tr -d '\r')
    D_MISS_RAW=$(echo "$LAST_LINE" | awk '{print $3}' | tr -d '\r')

    FINAL_D_HITS=$(( ${D_HITS_RAW:-0} + N_H ))
    FINAL_D_MISSES=$(( ${D_MISS_RAW:-0} + N_M ))

    D_SUM=$(( FINAL_D_HITS + FINAL_D_MISSES ))
    D_PCT=$(( D_SUM > 0 ? (FINAL_D_HITS * 100 / D_SUM) : 0 ))

    sed -i "$ s/.*/$FINAL_D_HITS \/ $FINAL_D_MISSES -- $DATE_STR ($D_PCT%)/" "$DAILY_LOG"
else
    FINAL_D_HITS=$N_H
    FINAL_D_MISSES=$N_M
    D_SUM=$(( FINAL_D_HITS + FINAL_D_MISSES ))
    D_PCT=$(( D_SUM > 0 ? (FINAL_D_HITS * 100 / D_SUM) : 0 ))
    echo "$FINAL_D_HITS / $FINAL_D_MISSES -- $DATE_STR ($D_PCT%)" >> "$DAILY_LOG"
fi

# Format numbers function for display
format_num() {
    awk -v n="$1" 'BEGIN {
        if (n >= 1000000) printf "%.2fM", n/1000000
        else if (n >= 1000) printf "%.2fK", n/1000
        else print n
    }'
}

HITS_FMT=$(format_num "$FINAL_D_HITS")
MISSES_FMT=$(format_num "$FINAL_D_MISSES")

# ---------------- SYSTEM STATS ----------------
HOSTNAME_S=$(hostname)
UP_STR=$(uptime -p | sed 's/up //')
LOAD=$(awk '{print $1,$2,$3}' /proc/loadavg)
read T_M F_M B_M CA_M SRE_M <<< $(awk '/MemTotal/ {t=$2} /MemFree/ {f=$2} /Buffers/ {b=$2} /^Cached/ {c=$2} /SReclaimable/ {s=$2} END {print t,f,b,c,s}' /proc/meminfo)
RAM_U=$(( (T_M - F_M - B_M - CA_M - SRE_M) / 1024 ))
RAM_T=$(( T_M / 1024 ))
RAM_P=$(( RAM_U * 100 / RAM_T ))

DF_LINE=$(df -h / | awk 'NR==2')
DISK_INFO=$(awk '{print $3 " / " $2 " (" $5 ")"}' <<< "$DF_LINE")
DISK_P=$(awk '{print $5}' <<< "$DF_LINE" | tr -d '%')

# Plain strings; JSON escaping is done by jq at the end.
ALERTS_ARR=()
[[ $RAM_P -ge 85 ]] && ALERTS_ARR+=("High RAM Usage (${RAM_P}%)")
[[ ${DISK_P:-0} -ge 90 ]] && ALERTS_ARR+=("High Disk Usage (${DISK_P}%)")

OOM_VICTIMS=$(journalctl -k --since "1 hour ago" --no-pager 2>/dev/null | grep -oP 'Out of memory: Killed process [0-9]+ \(\K[^)]+' | sort -u | paste -sd ',' | sed 's/,/, /g')
[[ -n "$OOM_VICTIMS" ]] && OOM="YES" || OOM="none"
[[ "$OOM" == "YES" ]] && ALERTS_ARR+=("OOM Kill Detected in Kernel Log ($OOM_VICTIMS)")

# ---------------- DYNAMIC SERVICES ----------------
SERVICES=($(find /etc/systemd/system/ -maxdepth 1 -type f -name "*.service" -exec basename {} \; | grep -vE "$SERVICE_EXCLUDE" | sort))

# One systemctl call for every unit. Output is one blank-line-separated block
# per unit; property order is not guaranteed.
declare -A U_ACTIVE U_ENABLED
b_id=""; b_active=""; b_enabled=""
flush_unit() {
    [[ -n "$b_id" ]] && { U_ACTIVE[$b_id]=$b_active; U_ENABLED[$b_id]=$b_enabled; }
    b_id=""; b_active=""; b_enabled=""
}
while IFS= read -r line; do
    [[ -z "$line" ]] && { flush_unit; continue; }
    case "${line%%=*}" in
        Id) b_id=${line#*=} ;;
        ActiveState) b_active=${line#*=} ;;
        UnitFileState) b_enabled=${line#*=} ;;
    esac
done < <(systemctl show -p Id,ActiveState,UnitFileState -- "${SERVICES[@]}" 2>/dev/null)
flush_unit

# One journalctl call for every unit: last matching error line per unit.
declare -A U_ERR
if [[ ${#SERVICES[@]} -gt 0 ]]; then
    UNIT_ARGS=(); for SVC in "${SERVICES[@]}"; do UNIT_ARGS+=(-u "$SVC"); done
    while IFS=$'\t' read -r unit msg; do
        U_ERR[$unit]=$msg
    done < <(journalctl "${UNIT_ARGS[@]}" --since "1 hour ago" --no-pager -o json \
                --output-fields=UNIT,_SYSTEMD_UNIT,MESSAGE 2>/dev/null | jq -r '
        select(.MESSAGE | type == "string")
        | select(.MESSAGE | test("\\b(error|failed|refused|timed out)\\b|\\] E "; "i"))
        | [(.UNIT // ._SYSTEMD_UNIT),
           ((.__REALTIME_TIMESTAMP | tonumber / 1000000 | strflocaltime("%b %d %H:%M:%S")) + ": "
             + (.MESSAGE | sub("^.*\\] E "; "E ") | gsub("[[:cntrl:]\"\\\\]"; "")))]
        | @tsv' 2>/dev/null)
fi

: > "$T/services.tsv"
CLI_OUTPUT=""

for SVC in "${SERVICES[@]}"; do
    NAME=${SVC%%.service}
    IS_ACTIVE=${U_ACTIVE[$SVC]:-inactive}
    IS_ENABLED=${U_ENABLED[$SVC]}
    ERR_SAN=$(cut -c 1-90 <<< "${U_ERR[$SVC]}")

    if [[ "$NAME" == "arm-grabber" ]]; then
        [[ "$IS_ACTIVE" == "active" ]] && AG_STATE="running" || AG_STATE="not running"
        # The grabber usually exits after a successful grab, so check the log regardless of state.
        [[ -f "$ARM_GRAB_SUCCESS_LOG" ]] && AG_GRAB="yes" || AG_GRAB="no"
        [[ "$AG_GRAB" == "yes" ]] && ALERTS_ARR+=("ARM instance grabbed on $HOSTNAME_S")
        printf '%s\t%s\t%s\t%s\t%s\n' "$NAME" "$AG_STATE" "OK" "" "$AG_GRAB" >> "$T/services.tsv"
        CLI_OUTPUT+="ARM-GRABBER : State: $AG_STATE | Grabbed: $AG_GRAB\n"
        continue
    fi

    if [[ "$IS_ACTIVE" != "active" ]]; then
        if [[ "$IS_ENABLED" == "disabled" ]]; then STATUS="DISABLED"; CLI_OUTPUT+="${C}DISABLED${RST}    : $NAME\n"
        elif [[ -n "$ERR_SAN" ]]; then STATUS="ERRORS_FOUND"; ALERTS_ARR+=("$NAME: $ERR_SAN"); CLI_OUTPUT+="${R}ERRORS_FOUND${RST}: $NAME -> $ERR_SAN\n"
        else STATUS="DOWN"; ALERTS_ARR+=("$NAME is $IS_ACTIVE"); CLI_OUTPUT+="${R}DOWN${RST}        : $NAME\n"; fi
    elif [[ -n "$ERR_SAN" ]]; then STATUS="INFO"; CLI_OUTPUT+="${C}INFO${RST}        : $NAME -> $ERR_SAN\n"
    else STATUS="OK"; CLI_OUTPUT+="${G}OK${RST}          : $NAME\n"; fi
    printf '%s\t%s\t%s\t%s\t%s\n' "$NAME" "$IS_ACTIVE" "$STATUS" "$ERR_SAN" "" >> "$T/services.tsv"
done

# ---------------- COLLECT BACKGROUND PROBES ----------------
wait
PI_PING=$(<"$T/ping")
STEAL_INT=${STEAL%.*}
[[ ${STEAL_INT:-0} -ge $STEAL_ALERT_PCT ]] && ALERTS_ARR+=("High CPU Steal Time (${STEAL}%)")
[[ "$PI_PING" == "UNREACHABLE" ]] && ALERTS_ARR+=("Pi5 Tunnel ($PI_TUNNEL_IP) is DOWN")

# ---------------- JSON BUILD ----------------
ISSUES=${#ALERTS_ARR[@]}
if [[ $ISSUES -gt 0 ]]; then JSON_ALERTS=$(printf '%s\n' "${ALERTS_ARR[@]}" | jq -R . | jq -sc .); else JSON_ALERTS='[]'; fi
SERVICES_JSON=$(jq -R -s -c 'split("\n") | map(select(length > 0) | split("\t")
    | {(.[0]): ({status: .[1], health: .[2]} + (if (.[4] // "") != "" then {grabbed: .[4]} else {last_error: (.[3] // "")} end))})
    | add // {}' "$T/services.tsv")

JSON_OUT=$(jq -n \
    --arg hostname "$HOSTNAME_S" --arg uptime "$UP_STR" --arg load "$LOAD" \
    --arg ram_u "$RAM_U" --arg ram_t "$RAM_T" --arg ram_pct "$RAM_P" \
    --arg disk_info "$DISK_INFO" --arg disk_pct "$DISK_P" --arg oom "$OOM" --arg oom_victims "${OOM_VICTIMS:-none}" \
    --arg steal "${STEAL:-0}" \
    --arg hits "$FINAL_D_HITS" --arg hits_fmt "$HITS_FMT" --arg misses "$FINAL_D_MISSES" --arg misses_fmt "$MISSES_FMT" --arg pct "$D_PCT" \
    --arg pi_tunnel "$PI_PING" --arg pi_tunnel_ip "$PI_TUNNEL_IP" \
    --argjson services "$SERVICES_JSON" --argjson alerts "$JSON_ALERTS" \
    '{
      hostname: $hostname,
      system: {uptime: $uptime, load: $load, ram_u: $ram_u, ram_t: $ram_t, ram_pct: $ram_pct,
               disk_info: $disk_info, disk_pct: $disk_pct, oom_kills: $oom, oom_victims: $oom_victims, cpu_steal: $steal},
      cache_stats: {hits: $hits, hits_formatted: $hits_fmt, misses: $misses, misses_formatted: $misses_fmt, hit_rate_pct: $pct},
      network: {pi_tunnel: $pi_tunnel, pi_tunnel_ip: $pi_tunnel_ip},
      services: $services,
      active_alerts: $alerts
    }')

echo "$JSON_OUT" >> "$LOG_FILE"

# ---------------- OUTPUT MODE ----------------
if [[ "$1" == "--api" ]]; then
    http_reply "200 OK" "application/json" "$JSON_OUT"
else
    echo -e "${W}--- VM SYSTEM STATS ---${RST}"
    echo -e "HOSTNAME: $HOSTNAME_S"
    echo -e "UPTIME:   $UP_STR"
    echo -e "LOAD:     $LOAD | OOM Kills: $OOM${OOM_VICTIMS:+ ($OOM_VICTIMS)} | CPU Steal: ${STEAL:-0}%"
    [[ "$PI_PING" == "REACHABLE" ]] && echo -e "TUNNEL:   Pi5 ($PI_TUNNEL_IP) is ${G}REACHABLE${RST}" || echo -e "TUNNEL:   Pi5 ($PI_TUNNEL_IP) is ${R}UNREACHABLE${RST}"
    [[ $RAM_P -ge 85 ]] && echo -e "MEMORY:   ${Y}${RAM_U}MiB / ${RAM_T}MiB (${RAM_P}%)${RST}" || echo -e "MEMORY:   ${RAM_U}MiB / ${RAM_T}MiB (${RAM_P}%)"
    [[ ${DISK_P:-0} -ge 90 ]] && echo -e "DISK (/): ${Y}${DISK_INFO}${RST}" || echo -e "DISK (/): ${DISK_INFO}"
    echo -e "STREAMING CACHE: Hits: ${G}${HITS_FMT}${RST} | Misses: ${R}${MISSES_FMT}${RST} | Rate: ${C}${D_PCT}%${RST}"
    echo ""
    echo -e "${W}--- SERVICES STATUS ---${RST}"
    echo -e "$CLI_OUTPUT"
    echo -e "${W}--- ACTIVE ALERTS ---${RST}"
    if [ $ISSUES -eq 0 ]; then echo -e "${G}None. All systems nominal.${RST}"
    else for alert in "${ALERTS_ARR[@]}"; do echo -e "• ${Y}${alert}${RST}"; done; fi
    echo ""
fi
