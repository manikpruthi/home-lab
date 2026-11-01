#!/bin/bash
# Pi5 health report. `--json` for the dashboard Worker, no args for the CLI view.
# Host-specific values live in env_files/health.env next to this script (see env_files/health.env.example).

# Guarantee API/Cron runs have the same PATH as your manual terminal
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"
export LC_ALL=C.UTF-8
: "${HOME:=$(getent passwd "$(id -un)" | cut -d: -f6)}"

# ---------------- CONFIG ----------------
SCRIPT_DIR=$(dirname "$(readlink -f "$0")")
CONFIG_FILE="${HEALTH_CONFIG:-$SCRIPT_DIR/env_files/health.env}"
if [[ -f "$CONFIG_FILE" ]]; then
    # shellcheck source=/dev/null
    source "$CONFIG_FILE"
else
    echo "health.sh: config not found at $CONFIG_FILE (copy env_files/health.env.example)" >&2
fi

BOOT_ID="${BOOT_ID:-}"; WD_ID="${WD_ID:-}"; TOSHIBA_ID="${TOSHIBA_ID:-}"
DNS6_SERVER="${DNS6_SERVER:-::1}"
read -ra VM_IPS <<< "${VM_IPS:-}"
SERVICE_EXCLUDE="${SERVICE_EXCLUDE:-cloudflared-update|pi-health-api}"
LOG_DIR="${LOG_DIR:-$HOME/logs/health}"

# ---------------- LOGGING & ROTATION ----------------
ARCH_DIR="$LOG_DIR/archive"
mkdir -p "$ARCH_DIR"

if [[ "$1" == "--json" ]]; then
    LOG_FILE="$LOG_DIR/api_health.log"
else
    LOG_FILE="$LOG_DIR/health.log"
fi

if [[ -f "$LOG_FILE" ]]; then
    SIZE=$(stat -c%s "$LOG_FILE" 2>/dev/null)
    if [[ ${SIZE:-0} -ge 102400 ]]; then
        mv "$LOG_FILE" "$ARCH_DIR/$(basename "$LOG_FILE" .log).$(date +%Y%m%d_%H%M%S).log"
        # Archive used to grow forever; keep 30 days.
        find "$ARCH_DIR" -name '*.log' -mtime +30 -delete 2>/dev/null
    fi
fi

echo -e "\n=== RUN: $(date) ===" >> "$LOG_FILE"

# Colors
R="\033[31m"; G="\033[32m"; Y="\033[33m"; B="\033[34m"; M="\033[35m"; C="\033[36m"; W="\033[37m"; RST="\033[0m"
SMART_CACHE="/tmp/h_smart_cache"; mkdir -p "$SMART_CACHE"

# Scratch dir for the parallel checks below
T=$(mktemp -d /tmp/health.XXXXXX)
trap 'rm -rf "$T"' EXIT

# ---------------- DEVICE RESOLVE ----------------
resolve_dev() { [[ -n "$1" ]] && readlink -f "/dev/disk/by-id/$1" 2>/dev/null; }
B_DEV=$(resolve_dev "$BOOT_ID")
W_DEV=$(resolve_dev "$WD_ID")
T_DEV=$(resolve_dev "$TOSHIBA_ID")

# =================================================================
# PARALLEL CHECKS
# Every slow / network-bound probe runs as a background job writing to $T,
# so the total runtime is the slowest probe, not the sum of all of them.
# =================================================================
ok_or_x() { "$@" >/dev/null 2>&1 && echo "✓" || echo "✗"; }
dns_ok() { dig +time=2 +tries=1 +short @"$1" google.com 2>/dev/null | grep -q .; }
ip6_ok() { ip -6 addr show scope global | grep -q inet6 && ping -6 -c1 -W2 2606:4700:4700::1111; }

get_p() {
    local val=$(timeout 8 df -h "$1" 2>/dev/null | awk 'NR==2 {print $5}' | tr -d '%')
    [[ -z "$val" ]] && echo "ERR" || echo "$val"
}

get_usb_stat() {
    local dev=$1; [[ ! -b "$dev" ]] && echo "OFFLINE" && return
    local base=$(basename "$dev")
    # /sys/class/block/<dev> links into the USB topology; no recursive sysfs walk needed.
    local path=$(readlink -f "/sys/class/block/$base" | grep -oP '.*usb[0-9]+/[0-9./-]+(?=/)' | head -1)
    local spd=$(cat "$path/speed" 2>/dev/null || echo "???")
    local drv=$(udevadm info -q property -n "$dev" | awk -F= '/ID_USB_DRIVER/ {print $2}')
    echo "${spd}M [${drv:-unknown}]"
}

refresh_smart() {
    local name=$1 dev=$2 cache="$SMART_CACHE/$1"
    [[ -b "$dev" ]] || return
    if [[ ! -f "$cache" || $(($(date +%s) - $(stat -c %Y "$cache"))) -gt 600 ]]; then
        if [[ "$name" == "boot" ]]; then
            sudo smartctl -d sntrealtek -a "$dev" > "$cache.tmp" 2>/dev/null || sudo smartctl -a "$dev" > "$cache.tmp" 2>/dev/null
        else
            sudo smartctl -A "$dev" > "$cache.tmp" 2>/dev/null || sudo smartctl -A -d sat "$dev" > "$cache.tmp" 2>/dev/null
        fi
        mv "$cache.tmp" "$cache"
    fi
}

ok_or_x dns_ok 127.0.0.1         > "$T/dns4" &
ok_or_x dns_ok "$DNS6_SERVER"    > "$T/dns6" &
ok_or_x ping -c1 -W2 1.1.1.1     > "$T/ip4" &
ok_or_x ip6_ok                   > "$T/ip6" &
for i in "${!VM_IPS[@]}"; do
    (ping -c1 -W2 "${VM_IPS[$i]}" >/dev/null 2>&1 && echo "REACHABLE" || echo "UNREACHABLE") > "$T/vm$((i+1))" &
done
sudo timeout 5 wg show wg1 > "$T/wg" 2>/dev/null &
timeout 5 tailscale status --json > "$T/ts" 2>/dev/null &
(timeout 5 pivpn -c 2>/dev/null | sed -n '/Name/,/:::/p' | grep -vE "Name|:::" | awk '{print $1 " [RX:" $4 " TX:" $5 "]"}' | paste -sd '|' | sed 's/|/ | /g') > "$T/pivpn" &
(LC_ALL=C sudo pidstat -d 1 1 2>/dev/null | awk '/^[0-9]/ && !/UID/ {rd=$4; wr=$5; print rd+wr, $8, rd/1024, wr/1024}' | sort -nr | awk 'NR<=3 {printf "%s(R:%.1fM W:%.1fM) ", $2, $3, $4}') > "$T/iotop" &
# -y skips the since-boot report, so both iowait and MB/s are for the last second.
(LC_ALL=C iostat -y -c -d -m 1 1 2>/dev/null) > "$T/iostat" &
get_p "${B_DEV}2" > "$T/b_p" &
get_p "${W_DEV}1" > "$T/w_p" &
get_p "${T_DEV}1" > "$T/t_p" &
for D in "boot:$B_DEV" "WD:$W_DEV" "toshiba:$T_DEV"; do refresh_smart "${D%%:*}" "${D##*:}" & done
if command -v docker >/dev/null 2>&1 && systemctl is-active --quiet docker; then
    (sudo timeout 5 docker ps --filter "health=unhealthy" --format "{{.Names}}" | paste -sd ',' | sed 's/,/, /g') > "$T/d_unhealthy" &
    (sudo timeout 5 docker ps -a --filter "status=exited" --filter "status=dead" --format "{{.Names}}" | paste -sd ',' | sed 's/,/, /g') > "$T/d_down" &
    DOCKER_UP=1
fi

# ---------------- UPTIME & CRASH DETECTION ----------------
UP_SEC=$(awk '{print int($1)}' /proc/uptime)
UP_STR=$(uptime -p | sed 's/up //')
CRASH_MSG=""

if [[ "$UP_SEC" -lt 3600 ]]; then
    if sudo ls -A /sys/fs/pstore 2>/dev/null | grep -q .; then
        CRASH_MSG="Kernel Panic Detected. Check /sys/fs/pstore/"
    elif journalctl -b -1 -n 1 >/dev/null 2>&1 && ! journalctl -b -1 -n 1000 2>/dev/null | grep -q "shutdown.target"; then
        CRASH_MSG="Unclean Shutdown Detected."
    fi
fi

# ---------------- ISSUES & ALERTS ARRAYS ----------------
# Plain strings; JSON escaping is done by jq at the end.
ALERTS_ARR=()

# ---------------- DYNAMIC SERVICE INFO ----------------
PI_SVC_INFO=()
SVC_DOWN_LIST=""
SERVICES=($(find /etc/systemd/system/ -maxdepth 1 -type f -name "*.service" -exec basename {} \; | grep -vE "$SERVICE_EXCLUDE" | sort))
CLI_OUTPUT=""
: > "$T/services.tsv"

# One systemctl call for every unit instead of four per unit.
# Output is one blank-line-separated block per unit; property order is not guaranteed.
declare -A U_TYPE U_ACTIVE U_ENABLED
b_id=""; b_type=""; b_active=""; b_enabled=""
flush_unit() {
    [[ -n "$b_id" ]] && { U_TYPE[$b_id]=$b_type; U_ACTIVE[$b_id]=$b_active; U_ENABLED[$b_id]=$b_enabled; }
    b_id=""; b_type=""; b_active=""; b_enabled=""
}
while IFS= read -r line; do
    [[ -z "$line" ]] && { flush_unit; continue; }
    case "${line%%=*}" in
        Id) b_id=${line#*=} ;;
        Type) b_type=${line#*=} ;;
        ActiveState) b_active=${line#*=} ;;
        UnitFileState) b_enabled=${line#*=} ;;
    esac
done < <(systemctl show -p Id,Type,ActiveState,UnitFileState -- "${SERVICES[@]}" 2>/dev/null)
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
        | select(.MESSAGE | test("\\[NOTICE\\]") | not)
        | select(.MESSAGE | test("\\b(error|failed|refused|timed out|errorCode)\\b|\\] E "; "i"))
        | [(.UNIT // ._SYSTEMD_UNIT),
           ((.__REALTIME_TIMESTAMP | tonumber / 1000000 | strflocaltime("%b %d %H:%M:%S")) + ": "
             + (.MESSAGE | sub("^.*\\] (?<l>E |ERR )"; "\(.l)") | gsub("[[:cntrl:]\"\\\\]"; "")))]
        | @tsv' 2>/dev/null)
fi

for SVC in "${SERVICES[@]}"; do
    NAME=${SVC%%.service}
    TYPE=${U_TYPE[$SVC]}
    IS_ACTIVE=${U_ACTIVE[$SVC]:-inactive}
    IS_ENABLED=${U_ENABLED[$SVC]}
    ERRORS=${U_ERR[$SVC]}

    STATUS="OK"
    ERR_SAN=""

    if [[ "$TYPE" == "oneshot" ]]; then
        if [[ "$IS_ACTIVE" == "failed" ]]; then
            STATUS="DOWN"
        else
            IS_ACTIVE="exited"
        fi
    elif [[ "$IS_ACTIVE" != "active" ]]; then
        STATUS="DOWN"
    fi

    if [[ "$STATUS" == "DOWN" && "$IS_ENABLED" == "disabled" ]]; then
        STATUS="INFO"
        ERR_SAN="Service is disabled"
        PI_SVC_INFO+=("$NAME: $ERR_SAN")
        CLI_OUTPUT+="${C}INFO${RST}        : $NAME -> $ERR_SAN\n"
    elif [[ "$STATUS" == "DOWN" ]]; then
        ALERTS_ARR+=("$NAME is DOWN")
        CLI_OUTPUT+="${R}DOWN${RST}        : $NAME\n"
        SVC_DOWN_LIST+="$NAME, "
    elif [[ -n "$ERRORS" ]]; then
        STATUS="INFO"
        ERR_SAN=$(cut -c 1-140 <<< "$ERRORS")
        PI_SVC_INFO+=("$NAME: $ERR_SAN")
        CLI_OUTPUT+="${C}INFO${RST}        : $NAME -> $ERR_SAN\n"
    else
        CLI_OUTPUT+="${G}OK${RST}          : $NAME\n"
    fi

    printf '%s\t%s\t%s\t%s\n' "$NAME" "$IS_ACTIVE" "$STATUS" "$ERR_SAN" >> "$T/services.tsv"
done
SVC_DOWN_LIST=${SVC_DOWN_LIST%, }

# ---------------- QUICK LOCAL READS ----------------
NET_DAY=$(vnstat -d --oneline 2>/dev/null | awk -F';' '{print "RX: "$4" | TX: "$5}')
NET_DAY=${NET_DAY:-vnstat unavailable}
V6_ERR=$(ip -6 addr show | grep -E "tentative|dadfailed" | awk '{print $2}' | xargs)

IN_P=$(timeout 2 df -i / | awk 'NR==2 {print $5}' | tr -d '%')
# Match the bare "ro" option only (not e.g. errors=remount-ro).
FILESYS=$(findmnt -no OPTIONS / | tr ',' '\n' | grep -qx ro && echo "READ-ONLY" || echo "RW")
FD_COUNT=$(awk '{print $1}' /proc/sys/fs/file-nr)

B_USB=$(get_usb_stat "$B_DEV"); W_USB=$(get_usb_stat "$W_DEV"); T_USB=$(get_usb_stat "$T_DEV")

read T_M F_M B_M CA_M SRE_M <<< $(awk '/MemTotal/ {t=$2} /MemFree/ {f=$2} /Buffers/ {b=$2} /^Cached/ {c=$2} /SReclaimable/ {s=$2} END {print t,f,b,c,s}' /proc/meminfo)
RAM_U=$(( (T_M - F_M - B_M - CA_M - SRE_M) / 1024 )); RAM_T=$(( T_M / 1024 )); RAM_P=$(( RAM_U * 100 / RAM_T ))
SWAP_U=$(free -m | awk '/Swap/ {print $3}')
LOAD=$(awk '{print $1,$2,$3}' /proc/loadavg)
TEMP=$(awk '{printf "%.1f",$1/1000}' /sys/class/thermal/thermal_zone0/temp)
FAN=$(cat /sys/class/thermal/cooling_device0/cur_state 2>/dev/null)
THROTTLE=$(vcgencmd get_throttled 2>/dev/null | cut -d= -f2)
ZOMBIES=$(ps -eo state= | grep -c '^Z')
ZOMBIE_LIST=$(ps -eo pid,ppid,state,cmd | awk '$3=="Z"' | head -n 5)

# Only real OOM-killer events (a bare "oom" grep matched unrelated kernel lines).
OOM_VICTIMS=$(journalctl -k --since "1 hour ago" --no-pager 2>/dev/null | grep -oP 'Out of memory: Killed process [0-9]+ \(\K[^)]+' | sort -u | paste -sd ',' | sed 's/,/, /g')
[[ -n "$OOM_VICTIMS" ]] && OOM_KILLS="YES" || OOM_KILLS="none"

get_top() {
    ps -eo $1,args --sort=-$1 | awk 'NR>1 && NR<5 {
        cmd=$2; sub(/.*\//, "", cmd);
        arg=$3; sub(/.*\//, "", arg);
        if (cmd=="python3" || cmd=="node" || cmd=="java" || cmd=="bash" || cmd=="sh") name=cmd"+"arg;
        else name=cmd;
        printf "%s(%.1f%%) ", name, $1
    }'
}
CPU_TOP=$(get_top pcpu); RAM_TOP=$(get_top pmem)

# ---------------- COLLECT PARALLEL RESULTS ----------------
wait

DNS4_S=$(<"$T/dns4"); DNS6_S=$(<"$T/dns6"); IP4_S=$(<"$T/ip4"); IP6_S=$(<"$T/ip6")

# One "VMn [REACHABLE|UNREACHABLE] HS: <handshake>" line per entry in VM_IPS.
WG_STAT=$(<"$T/wg")
VM_LINES=()
for i in "${!VM_IPS[@]}"; do
    HS=$(grep -A 2 -F "${VM_IPS[$i]}/32" <<< "$WG_STAT" | grep "latest handshake" | awk -F': ' '{print $2}')
    VM_LINES+=("VM$((i+1)) [$(<"$T/vm$((i+1))")] HS: ${HS:-No handshake}")
done

TS_STATE=$(jq -r '.BackendState // empty' "$T/ts" 2>/dev/null)
TS_STAT=$(jq -r '[(.Self.TailscaleIPs[0] // empty), (.Self.HostName // empty)] | join(" ")' "$T/ts" 2>/dev/null)
TS_STATE=${TS_STATE:-OFFLINE}
[[ "$TS_STATE" != "Running" ]] && TS_STAT="OFFLINE"

PIVPN_CLI=$(<"$T/pivpn")
IO_TOP=$(<"$T/iotop"); IO_TOP=${IO_TOP:-none}

IOW=$(awk '/^avg-cpu/ {getline; print $4; exit}' "$T/iostat")
io_for() {
    local dev; dev=$(basename "${1:-none}")
    local res; res=$(awk -v d="$dev" '$1==d {print $3" R | "$4" W (MB/s)"; exit}' "$T/iostat")
    echo "${res:-none}"
}
B_IO=$(io_for "$B_DEV"); W_IO=$(io_for "$W_DEV"); T_IO=$(io_for "$T_DEV")

B_P=$(<"$T/b_p"); W_P=$(<"$T/w_p"); T_P=$(<"$T/t_p")

if [[ -n "$DOCKER_UP" ]]; then
    D_UNHEALTHY=$(<"$T/d_unhealthy"); D_DOWN=$(<"$T/d_down")
    [[ -n "$D_UNHEALTHY" ]] && DOCKER_S="⚠" || DOCKER_S="✓"
else
    DOCKER_S="✗"
    D_UNHEALTHY="Docker Daemon Offline"
    D_DOWN="Docker Daemon Offline"
fi

# ---------------- VPN HEALTH CHECK ----------------
VPN_S="✓"; VPN_ERR=""
ip link show wg0 >/dev/null 2>&1 || { VPN_S="⚠"; VPN_ERR+="PiVPN(wg0) Down, "; }
ip link show wg1 >/dev/null 2>&1 || { VPN_S="⚠"; VPN_ERR+="OCI(wg1) Down, "; }
[[ "$TS_STATE" == "Running" ]] || { VPN_S="⚠"; VPN_ERR+="Tailscale Down ($TS_STATE), "; }
VPN_ERR=${VPN_ERR%, }

# ---------------- SMART & SSD LIFESPAN ----------------
SMART_LOG=""; SMART_ISSUES=0; B_TBW="???"
for D in "boot:$B_DEV" "WD:$W_DEV" "toshiba:$T_DEV"
do
    NAME=${D%%:*}; DEV=${D##*:}; CACHE="$SMART_CACHE/$NAME"
    [[ -b "$DEV" && -f "$CACHE" ]] || continue

    if [[ "$NAME" == "boot" ]]; then
        # NVMe-specific check
        CRIT=$(awk '/Critical Warning:/ {print $3}' "$CACHE")
        [[ -n "$CRIT" && "$CRIT" != "0x00" ]] && SMART_LOG+="boot:Crit=$CRIT " && ((SMART_ISSUES++))
        # Display N/A if bridge blocks Data Units Written
        B_TBW=$(grep "Data Units Written:" "$CACHE" | grep -o '\[.*\]' | tr -d '[]')
        [[ -z "$B_TBW" ]] && B_TBW="N/A (Bridge)"
    else
        # SATA-specific check
        RE=$(awk '/Reallocated_Sector_Ct/ {print $10}' "$CACHE" | head -1)
        PE=$(awk '/Current_Pending_Sector/ {print $10}' "$CACHE" | head -1)
        UE=$(awk '/Offline_Uncorrectable/ {print $10}' "$CACHE" | head -1)

        RE_THRESH=0
        [[ "$NAME" == "toshiba" ]] && RE_THRESH=24

        [[ "$RE" =~ ^[0-9]+$ && "$RE" -gt $RE_THRESH ]] && SMART_LOG+="$NAME:Realloc=$RE " && ((SMART_ISSUES++))
        [[ "$PE" =~ ^[0-9]+$ && "$PE" -gt 0 ]] && SMART_LOG+="$NAME:Pending=$PE " && ((SMART_ISSUES++))
        [[ "$UE" =~ ^[0-9]+$ && "$UE" -gt 0 ]] && SMART_LOG+="$NAME:Offline=$UE " && ((SMART_ISSUES++))
    fi
done
SMART_LOG=${SMART_LOG% }

# ---------------- ALERTS ----------------
# get_throttled: bits 0-3 = happening now, bits 16-19 = happened since boot.
THR_NOW=0; THR_PAST=0
if [[ "$THROTTLE" =~ ^0x[0-9a-fA-F]+$ ]]; then
    THR_NOW=$(( THROTTLE & 0xF )); THR_PAST=$(( (THROTTLE >> 16) & 0xF ))
else
    THR_NOW=1  # vcgencmd failed; surface it
fi
throttle_desc() {
    local bits=$1 out=()
    (( bits & 1 )) && out+=("under-voltage")
    (( bits & 2 )) && out+=("freq-capped")
    (( bits & 4 )) && out+=("throttled")
    (( bits & 8 )) && out+=("soft-temp-limit")
    local IFS=,; echo "${out[*]}"
}
THR_TXT=""
(( THR_NOW )) && THR_TXT="now: $(throttle_desc $THR_NOW)"
(( THR_PAST )) && THR_TXT+="${THR_TXT:+; }since boot: $(throttle_desc $THR_PAST)"

[[ $SMART_ISSUES -gt 0 ]] && ALERTS_ARR+=("SMART Degradation ($SMART_LOG)")
[[ "$B_P" == "ERR" ]] && ALERTS_ARR+=("Boot Disk Timeout")
[[ "$W_P" == "ERR" ]] && ALERTS_ARR+=("WD Disk Timeout")
[[ "$T_P" == "ERR" ]] && ALERTS_ARR+=("Toshiba Disk Timeout")
for D in "Boot:$B_P" "WD:$W_P" "Toshiba:$T_P"; do
    PCT=${D##*:}; [[ "$PCT" =~ ^[0-9]+$ && $PCT -ge 90 ]] && ALERTS_ARR+=("${D%%:*} Disk Usage High (${PCT}%)")
done
[[ "$FILESYS" == "READ-ONLY" ]] && ALERTS_ARR+=("Root Filesystem Read-Only")
[[ -n "$V6_ERR" ]] && ALERTS_ARR+=("IPv6 Error ($V6_ERR)")
[[ "$DNS4_S" == "✗" ]] && ALERTS_ARR+=("DNS Resolution Failing (local resolver)")
[[ "$DNS6_S" == "✗" ]] && ALERTS_ARR+=("DNS Resolution Failing (IPv6 resolver $DNS6_SERVER)")
[[ "$IP4_S" == "✗" ]] && ALERTS_ARR+=("IPv4 Internet Unreachable")
[[ -n "$CRASH_MSG" ]] && ALERTS_ARR+=("Unclean Shutdown / Crash")
[[ $RAM_P -ge 85 ]] && ALERTS_ARR+=("High Memory Usage (${RAM_P}%)")

TEMP_INT=${TEMP%.*}
[[ ${TEMP_INT:-0} -ge 75 ]] && ALERTS_ARR+=("High CPU Temp (${TEMP}°C)")

[[ -n "$D_UNHEALTHY" && "$D_UNHEALTHY" != "Docker Daemon Offline" ]] && ALERTS_ARR+=("Unhealthy Docker (${D_UNHEALTHY})")
[[ -n "$VPN_ERR" ]] && ALERTS_ARR+=("VPN Offline (${VPN_ERR})")

IO_INT=${IOW%.*}
[[ ${IO_INT:-0} -gt 50 ]] && ALERTS_ARR+=("High I/O Wait (${IOW}%)")

[[ "$OOM_KILLS" == "YES" ]] && ALERTS_ARR+=("OOM Kill Detected ($OOM_VICTIMS)")
(( THR_NOW )) && ALERTS_ARR+=("CPU Throttling Detected ($THROTTLE, $THR_TXT)")
[[ $ZOMBIES -gt 5 ]] && ALERTS_ARR+=("High Zombie Processes ($ZOMBIES)")

ISSUES=${#ALERTS_ARR[@]}

# =================================================================
# WORKER JSON OUTPUT MODE
# Built with jq so journal lines, process names etc. can never break the JSON.
# =================================================================
if [[ "$1" == "--json" ]]; then
    to_json_array() { if [[ $# -gt 0 ]]; then printf '%s\n' "$@" | jq -R . | jq -sc .; else echo '[]'; fi; }
    SERVICES_JSON=$(jq -R -s -c 'split("\n") | map(select(length > 0) | split("\t") | {(.[0]): {status: .[1], health: .[2], last_error: (.[3] // "")}}) | add // {}' "$T/services.tsv")
    OCI_JSON=$(to_json_array "${VM_LINES[@]}" | jq -c 'to_entries | map({("oci_vm\(.key + 1)"): .value}) | add // {}')

    JSON_OUT=$(jq -n \
        --arg uptime "$UP_STR" --arg load "$LOAD" --arg temp "$TEMP" --arg fan "$FAN" \
        --arg ram_pct "$RAM_P" --arg ram_u "$RAM_U" --arg ram_t "$RAM_T" --arg iowait "${IOW:-0}" \
        --arg crash_msg "${CRASH_MSG:-none}" --arg swap "$SWAP_U" --arg zombies "$ZOMBIES" \
        --arg oom "$OOM_KILLS" --arg oom_victims "${OOM_VICTIMS:-none}" \
        --arg throttle "$THROTTLE" --arg throttle_desc "${THR_TXT:-none}" \
        --arg cpu_top "$CPU_TOP" --arg ram_top "$RAM_TOP" --arg io_top "$IO_TOP" \
        --arg boot_pct "$B_P" --arg wd_pct "$W_P" --arg toshiba_pct "$T_P" \
        --arg inodes "$IN_P" --arg boot_tbw "${B_TBW:-0}" \
        --arg usb_boot "$B_USB" --arg usb_wd "$W_USB" --arg usb_tosh "$T_USB" \
        --arg filesys "$FILESYS" --arg fd "$FD_COUNT" \
        --arg io_boot "$B_IO" --arg io_wd "$W_IO" --arg io_tosh "$T_IO" \
        --arg traffic "$NET_DAY" --arg tailscale "$TS_STAT" --arg tailscale_state "$TS_STATE" --arg pivpn "$PIVPN_CLI" \
        --arg ipv6_err "${V6_ERR:-none}" --arg vpn_err "${VPN_ERR:-none}" \
        --argjson oci "$OCI_JSON" \
        --arg dns4 "${DNS4_S:-✗}" --arg dns6 "${DNS6_S:-✗}" --arg ipv4 "${IP4_S:-✗}" --arg ipv6 "${IP6_S:-✗}" \
        --arg d_unhealthy "${D_UNHEALTHY:-none}" --arg d_down "${D_DOWN:-none}" \
        --argjson services "$SERVICES_JSON" \
        --argjson issues "$ISSUES" --argjson smart_issues "$SMART_ISSUES" \
        --argjson alerts "$(to_json_array "${ALERTS_ARR[@]}")" \
        --argjson svc_info "$(to_json_array "${PI_SVC_INFO[@]}")" \
        --arg zombie_details "${ZOMBIE_LIST:-none}" \
        '{
          system: {uptime: $uptime, load: $load, temp: $temp, fan: $fan, ram_pct: $ram_pct, ram_u: $ram_u, ram_t: $ram_t,
                   iowait: $iowait, crash_msg: $crash_msg, swap: $swap, zombies: $zombies, oom: $oom, oom_victims: $oom_victims,
                   throttle: $throttle, throttle_desc: $throttle_desc},
          processes: {cpu_top: $cpu_top, ram_top: $ram_top, io_top: $io_top},
          storage: {boot_pct: $boot_pct, wd_pct: $wd_pct, toshiba_pct: $toshiba_pct, inodes: $inodes, boot_tbw: $boot_tbw,
                    usb_boot: $usb_boot, usb_wd: $usb_wd, usb_tosh: $usb_tosh, filesys: $filesys, fd: $fd},
          io_speeds: {boot: $io_boot, wd: $io_wd, toshiba: $io_tosh},
          network: ({traffic: $traffic, tailscale: $tailscale, tailscale_state: $tailscale_state, pivpn: $pivpn,
                    ipv6_err: $ipv6_err, vpn_err: $vpn_err} + $oci
                    + {dns4: $dns4, dns6: $dns6, ipv4: $ipv4, ipv6: $ipv6}),
          docker: {unhealthy: $d_unhealthy, down: $d_down},
          services: $services,
          summary: {issues_count: $issues, smart_issues: $smart_issues, active_alerts: $alerts,
                    service_info: $svc_info, zombie_details: $zombie_details}
        }')
    echo "$JSON_OUT" | tee -a "$LOG_FILE"
    exit 0
fi

# =================================================================
# STANDARD CLI DASHBOARD MODE
# =================================================================
{
[[ $RAM_P -ge 85 ]] && RAM_S="${Y}RAM⚠${RST}" || RAM_S="${G}RAM✓${RST}"
[[ ${TEMP_INT:-0} -ge 75 ]] && TEMP_S="${Y}TEMP⚠${RST}" || TEMP_S="${G}TEMP✓${RST}"

printf "${C}DNS4%s DNS6%s${RST} ${B}IPv4%s IPv6%s${RST} " "$DNS4_S" "$DNS6_S" "$IP4_S" "$IP6_S"
[[ "$B_P" == "ERR" || "$W_P" == "ERR" || "$T_P" == "ERR" ]] && printf "${Y}DISK⚠${RST} " || printf "${G}DISK✓${RST} "
printf "%b %b " "$RAM_S" "$TEMP_S"
[[ ${IO_INT:-0} -gt 50 ]] && printf "${Y}IO⚠${RST} " || printf "${G}IO✓${RST} "
printf "${M}VPN%s${RST} ${C}DOCKER%s${RST}\n\n" "$VPN_S" "$DOCKER_S"

echo -e "${W}--- NETWORK & TUNNELS ---${RST}"
echo -e "TRAFFIC:    $NET_DAY"
echo -e "IPv6 ERR:   ${V6_ERR:-None}"
echo -e "TAILSCALE:  $TS_STATE ${TS_STAT:-}"
for i in "${!VM_LINES[@]}"; do
    [[ $i -eq 0 ]] && LABEL="OCI-WG1:   " || LABEL="           "
    echo -e "$LABEL ${VM_LINES[$i]/ HS: / (${VM_IPS[$i]}) - Handshake: }"
done
echo -e "PIVPN:      ${PIVPN_CLI:-No active clients}"
echo ""

echo -e "${W}--- SYSTEM & STORAGE ---${RST}"
echo -e "DOCKER:   Unhealthy: ${D_UNHEALTHY:-None} | Down: ${D_DOWN:-None}"
echo -e "STORAGE:  boot:${B_P}% | WD:${W_P}% | toshiba:${T_P}% | Inodes:${IN_P}%"
echo -e "USB-BUS:  boot:${B_USB} | WD:${W_USB} | toshiba:${T_USB}"
echo -e "BOOT-SSD: Total Lifetime Writes: $B_TBW"
echo -e "UPTIME:   $UP_STR"
echo -e "FILESYS:  $FILESYS | FD:$FD_COUNT"
echo -e "MEMORY:   ${RAM_U}MiB / ${RAM_T}MiB (${RAM_P}%) | Swap:${SWAP_U}MiB"
printf "RAM-TOP:  %s\n" "$RAM_TOP"
echo -e "LOAD:     $LOAD | Zombies:$ZOMBIES | OOM:$OOM_KILLS${OOM_VICTIMS:+ ($OOM_VICTIMS)}"
printf "CPU-TOP:  %s\n" "$CPU_TOP"
printf "THERMAL:  %.1f°C | FAN: Lvl %s | THROTTLE:%s%s | IOWAIT:%s%%\n" "$TEMP" "$FAN" "$THROTTLE" "${THR_TXT:+ ($THR_TXT)}" "${IOW:-0}"

echo -e "\n${W}--- I/O THROUGHPUT ---${RST}"
printf "IO-TOP:   %s\n\n" "${IO_TOP:-none}"
printf "%-9s %s\n" "boot" "$B_IO" "WD" "$W_IO" "toshiba" "$T_IO"

echo -e "\n${W}--- SERVICES STATUS ---${RST}"
echo -e "$CLI_OUTPUT"

echo -e "\n${W}HEALTH SUMMARY & ACTION PLAN${RST}"

[[ -n "$SVC_DOWN_LIST" ]] && echo -e "• ${R}CRITICAL: System Services Offline ($SVC_DOWN_LIST)${RST}\n  Action: Run 'sudo systemctl status <service>' to investigate the crash and restart."
[[ $SMART_ISSUES -gt 0 ]] && echo -e "• ${Y}MONITOR: SMART Degradation ($SMART_LOG)${RST}\n  Action: Backup data immediately. Drive hardware is failing."
[[ "$B_P" == "ERR" ]] && echo -e "• ${R}CRITICAL: Boot Disk Latency (Timeout)${RST}\n  Action: System drive is unresponsive. Imminent kernel panic likely."
[[ "$W_P" == "ERR" ]] && echo -e "• ${R}ERROR: WD Disk Latency (Timeout)${RST}\n  Action: Drive is offline or mechanically unresponsive."
[[ "$T_P" == "ERR" ]] && echo -e "• ${R}ERROR: Toshiba Disk Latency (Timeout)${RST}\n  Action: Drive is mechanically sluggish. [usb-storage] is active to prevent bus crashes."
[[ "$FILESYS" == "READ-ONLY" ]] && echo -e "• ${R}CRITICAL: Root Filesystem Read-Only${RST}\n  Action: Check 'dmesg' for I/O errors on the boot SSD; the kernel remounts read-only on filesystem errors."
[[ -n "$V6_ERR" ]] && echo -e "• ${Y}WARNING: IPv6 Configuration Error ($V6_ERR)${RST}\n  Action: Check interface or router config for 'dadfailed' or 'tentative' state issues."
[[ "$DNS4_S" == "✗" || "$DNS6_S" == "✗" ]] && echo -e "• ${R}ERROR: DNS Resolution Failing (v4:$DNS4_S v6:$DNS6_S)${RST}\n  Action: Check the local resolver (Pi-hole/AdGuard/unbound) and its upstream."
[[ "$IP4_S" == "✗" ]] && echo -e "• ${R}ERROR: IPv4 Internet Unreachable${RST}\n  Action: Ping to 1.1.1.1 failed. Check router / WAN link."
[[ -n "$CRASH_MSG" ]] && echo -e "• ${R}ERROR: System Crash${RST}\n  Action: $CRASH_MSG"
[[ $RAM_P -ge 85 ]] && echo -e "• ${Y}WARNING: High Memory Usage (${RAM_P}%)${RST}\n  Action: Check RAM-TOP to identify memory hogs."
[[ ${TEMP_INT:-0} -ge 75 ]] && echo -e "• ${Y}WARNING: High CPU Temperature (${TEMP}°C)${RST}\n  Action: Check cooling fan and airflow. Pi begins throttling at 80°C."
[[ -n "$D_UNHEALTHY" && "$D_UNHEALTHY" != "Docker Daemon Offline" ]] && echo -e "• ${R}ERROR: Unhealthy Docker Containers ($D_UNHEALTHY)${RST}\n  Action: Inspect container logs (docker logs <name>) to fix failing internal health checks."
[[ -n "$VPN_ERR" ]] && echo -e "• ${Y}WARNING: VPN Network Disconnected ($VPN_ERR)${RST}\n  Action: Run 'systemctl status' for the failing tunnel interface to check for errors."

if [[ ${IO_INT:-0} -gt 50 ]]; then
    echo -e "• ${Y}WARNING: High CPU I/O Wait (${IOW}%)${RST}\n  Action: CPU is stalling while waiting for disks to read/write. Check IO-TOP. Normal during database or media scans."
fi

[[ -n "$D_DOWN" && "$D_DOWN" != "Docker Daemon Offline" ]] && echo -e "• ${C}INFO: Stopped/Exited Containers ($D_DOWN)${RST}\n  Note: Intentionally stopped containers are ignored from active alerts."

[[ "$OOM_KILLS" == "YES" ]] && echo -e "• ${R}CRITICAL: OOM Kill Detected ($OOM_VICTIMS)${RST}\n  Action: Run 'journalctl -k | grep -i oom' to see which process the kernel terminated for using too much RAM."
(( THR_NOW )) && echo -e "• ${Y}WARNING: CPU Throttling ($THROTTLE: $THR_TXT)${RST}\n  Action: The Pi is throttling. This usually means under-voltage (bad power supply) or extreme thermal limits."
(( ! THR_NOW && THR_PAST )) && echo -e "• ${C}INFO: Throttling occurred earlier since boot ($THR_TXT)${RST}\n  Note: Not happening now; check the power supply if this keeps appearing."
if [[ $ZOMBIES -gt 5 ]]; then
    echo -e "• ${Y}WARNING: Zombie Processes Accumulating ($ZOMBIES)${RST}"
    echo -e "  Action: Parent not reaping children"
    echo -e "  Top Zombies:"
    echo -e "$ZOMBIE_LIST\n"
fi
if [[ ${#PI_SVC_INFO[@]} -gt 0 ]]; then
    echo -e "\n${C}--- SERVICE INFO (LAST HOUR) ---${RST}"
    for info in "${PI_SVC_INFO[@]}"; do
        echo -e "• ${C}${info}${RST}"
    done
fi

[[ $ISSUES -eq 0 ]] && echo -e "\n${G}All systems operational.${RST}"
} | tee -a "$LOG_FILE"
