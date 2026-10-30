#!/usr/bin/env bash
# VPS-DOG agent one-liner installer.
#
#   curl -fsSL https://raw.githubusercontent.com/heshang2011/vps-dog/main/agent/install.sh | bash -s -- -s <server> -t <token>
#
# It detects the architecture, downloads the matching release binary and writes
# /etc/vps-dog/agent.yaml. Where systemd is available it also installs and starts
# a service unit; elsewhere — Docker containers, LXC templates, anything with no
# init system — the agent is started detached instead. Root is required, but
# sudo is not: the script escalates by itself when it needs to.
#
# Flags:
#   -s <url>     worker base URL                 (required)
#   -t <token>   agent token from the dashboard  (required)
#   -n <name>    node display name               (default: hostname)
#   -r <region>  region label, e.g. HK
#   -i <secs>    report interval                 (default: 30)
#   -k           skip TLS verification           (self-signed worker)
#   -v <ver>     agent version to install        (default: latest release)
#   -u           uninstall instead of installing
#   -h           show help
set -euo pipefail

REPO="${VPSDOG_REPO:-heshang2011/vps-dog}"
BIN_NAME="vps-dog"
BIN_PATH="/usr/local/bin/${BIN_NAME}"
CONFIG_DIR="/etc/vps-dog"
CONFIG_PATH="${CONFIG_DIR}/agent.yaml"
SERVICE_PATH="/etc/systemd/system/${BIN_NAME}.service"

SERVER=""
TOKEN=""
NODE_NAME="$(hostname 2>/dev/null || echo vps-dog)"
REGION=""
INTERVAL="30"
TLS_SKIP="false"
VERSION=""
UNINSTALL="false"
# Empty when we are already root; set to "sudo" otherwise (see the privilege
# check below). Every command that writes outside the temp dir is prefixed
# with it, so the whole installer works both as root and as a sudo user.
SUDO=""
# Set during preflight. Without systemd the agent is started with nohup and the
# operator (or the container runtime) is responsible for keeping it alive.
HAVE_SYSTEMD="false"
LOG_PATH="/var/log/${BIN_NAME}.log"
PID_PATH="/run/${BIN_NAME}.pid"

log()  { printf '\033[36m[vps-dog]\033[0m %s\n' "$*"; }
warn() { printf '\033[33m[vps-dog]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[31m[vps-dog]\033[0m %s\n' "$*" >&2; exit 1; }

usage() {
  sed -n '2,20p' "$0" 2>/dev/null | sed 's/^# \{0,1\}//' || true
  cat <<'EOF'
Flags:
  -s <url>     worker base URL                 (required)
  -t <token>   agent token from the dashboard  (required)
  -n <name>    node display name               (default: hostname)
  -r <region>  region label, e.g. HK
  -i <secs>    report interval                 (default: 30)
  -k           skip TLS verification           (self-signed worker)
  -v <ver>     agent version to install        (default: latest release)
  -u           uninstall instead of installing
  -h           show help
EOF
}

# ── background supervision (the no-systemd fallback) ─────────────────────
# Docker containers and LXC templates frequently have no init system at all,
# which is a perfectly reasonable place to run a monitoring agent. There the
# process is started detached instead of as a service unit. Everything runs
# inside `$SUDO sh -c '…'` so that the redirection, the backgrounding and the
# `$!` capture all happen with the right privileges.
start_background() {
  stop_background
  $SUDO install -m 0640 /dev/null "$LOG_PATH"
  $SUDO sh -c "nohup '${BIN_PATH}' -c '${CONFIG_PATH}' >> '${LOG_PATH}' 2>&1 & echo \$! > '${PID_PATH}'"
}

stop_background() {
  if [ -f "$PID_PATH" ]; then
    pid="$(cat "$PID_PATH" 2>/dev/null || true)"
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      $SUDO kill "$pid" 2>/dev/null || true
      sleep 1
      $SUDO kill -9 "$pid" 2>/dev/null || true
    fi
    $SUDO rm -f "$PID_PATH"
  fi
  # Also catch an instance whose PID file is gone — a restarted container
  # clears /run, which is usually a tmpfs.
  $SUDO pkill -x "${BIN_NAME}" 2>/dev/null || true
}

background_running() {
  pid="$(cat "$PID_PATH" 2>/dev/null || true)"
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}

while getopts ':s:t:n:r:i:v:kuh' opt; do
  case "$opt" in
    s) SERVER="$OPTARG" ;;
    t) TOKEN="$OPTARG" ;;
    n) NODE_NAME="$OPTARG" ;;
    r) REGION="$OPTARG" ;;
    i) INTERVAL="$OPTARG" ;;
    v) VERSION="$OPTARG" ;;
    k) TLS_SKIP="true" ;;
    u) UNINSTALL="true" ;;
    h) usage; exit 0 ;;
    :) die "option -${OPTARG} requires an argument" ;;
    \?) die "unknown option -${OPTARG} (try -h)" ;;
  esac
done

# ── preflight ────────────────────────────────────────────────────────────
[ "$(uname -s)" = "Linux" ] || die "this installer supports Linux only (found $(uname -s))"

if [ "$(id -u)" -ne 0 ]; then
  # Prefer escalating inside the script over demanding that the *command* wrap
  # us in sudo. Minimal images (Docker containers, LXC templates) routinely run
  # as root with no sudo binary at all, and `curl … | sudo bash` dies there
  # before a single line of this script gets to run.
  if command -v sudo >/dev/null 2>&1; then
    SUDO="sudo"
    log "not running as root; using sudo for the privileged steps"
  else
    die "must run as root, and no sudo was found. Re-run it as root, e.g. su -c '<the same command>'"
  fi
fi

# systemd is preferred but not required: Docker containers and LXC templates
# routinely have no init system, and refusing to install there would be
# needlessly strict. Without it the agent is started detached instead (see
# start_background) and the operator keeps it alive.
if command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]; then
  HAVE_SYSTEMD="true"
else
  warn "systemd not detected — the agent will run detached instead of as a service unit"
fi

if [ "$UNINSTALL" = "true" ]; then
  log "stopping and disabling ${BIN_NAME}"
  # Both paths are attempted: the host may have gained or lost systemd since the
  # agent was installed, and each command is a harmless no-op when it does not
  # apply.
  $SUDO systemctl disable --now "${BIN_NAME}" 2>/dev/null || true
  $SUDO rm -f "$SERVICE_PATH"
  $SUDO systemctl daemon-reload 2>/dev/null || true
  $SUDO systemctl reset-failed "${BIN_NAME}" 2>/dev/null || true
  stop_background
  log "agent stopped. Config kept at ${CONFIG_PATH}; delete it with: ${SUDO} rm -rf ${CONFIG_DIR} ${BIN_PATH}"
  exit 0
fi

[ -n "$SERVER" ] || die "-s <server> is required"
[ -n "$TOKEN" ]  || die "-t <token> is required"

case "$SERVER" in
  http://*|https://*) ;;
  *) die "-s must start with http:// or https:// (got '${SERVER}')" ;;
esac
SERVER="${SERVER%/}"

# These values are interpolated into a double-quoted YAML scalar below. A quote
# or newline would let them inject extra YAML keys (e.g. a node name of
# `x"\ntls_skip_verify: true` would silently disable TLS verification), so reject
# anything outside the safe set rather than trying to escape it.
for pair in "server:${SERVER}" "token:${TOKEN}" "name:${NODE_NAME}" "region:${REGION}"; do
  label="${pair%%:*}"
  value="${pair#*:}"
  case "$value" in
    *'"'*|*'\'*|*'
'*) die "-${label} must not contain a double quote, backslash or newline" ;;
  esac
done

case "$INTERVAL" in
  ''|*[!0-9]*) die "-i <interval> must be a whole number of seconds" ;;
esac

# ── detect architecture ──────────────────────────────────────────────────
case "$(uname -m)" in
  x86_64|amd64)  ARCH="amd64" ;;
  aarch64|arm64) ARCH="arm64" ;;
  armv7l|armv7)  ARCH="armv7" ;;
  armv6l|armv6)  ARCH="armv7" ;;
  i386|i486|i586|i686) ARCH="386" ;;
  *) die "unsupported architecture: $(uname -m)" ;;
esac

if [ -z "$VERSION" ]; then
  VERSION="$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" 2>/dev/null \
    | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"v\{0,1\}\([^"]*\)".*/\1/p' | head -n1)"
fi
[ -n "$VERSION" ] || die "could not determine the latest release; pass -v <version>"
VERSION="${VERSION#v}"

ASSET="${BIN_NAME}-linux-${ARCH}"
URL="https://github.com/${REPO}/releases/download/v${VERSION}/${ASSET}"
log "installing ${BIN_NAME} ${VERSION} for linux/${ARCH}"

# ── download ─────────────────────────────────────────────────────────────
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

DOWNLOADER=""
if command -v curl >/dev/null 2>&1; then DOWNLOADER="curl"
elif command -v wget >/dev/null 2>&1; then DOWNLOADER="wget"
else die "curl or wget is required"
fi

fetch() { # fetch <url> <dest>
  if [ "$DOWNLOADER" = "curl" ]; then
    curl -fsSL --retry 3 --connect-timeout 15 -o "$2" "$1"
  else
    wget -q -T 15 -O "$2" "$1"
  fi
}

log "downloading ${URL}"
fetch "$URL" "${TMP}/${BIN_NAME}" || die "download failed: ${URL}"

if [ ! -s "${TMP}/${BIN_NAME}" ]; then
  die "downloaded file is empty"
fi

# ── install ──────────────────────────────────────────────────────────────
$SUDO install -m 0755 "${TMP}/${BIN_NAME}" "${BIN_PATH}"
log "installed binary at ${BIN_PATH}"

$SUDO mkdir -p "$CONFIG_DIR"
$SUDO chmod 0750 "$CONFIG_DIR"

# Redirections are performed by *this* shell, so `cat > /etc/...` would still
# need root. `$SUDO tee` writes with the escalated privileges instead. The file
# is created up front so its mode is pinned: tee only truncates, it never
# re-chmods, hence the token is never briefly world-readable.
$SUDO install -m 0600 /dev/null "$CONFIG_PATH"
$SUDO tee "$CONFIG_PATH" >/dev/null <<EOF
# VPS-DOG agent configuration — generated by install.sh
server: "${SERVER}"
token: "${TOKEN}"
name: "${NODE_NAME}"
EOF
if [ -n "$REGION" ]; then
  printf 'region: "%s"\n' "$REGION" | $SUDO tee -a "$CONFIG_PATH" >/dev/null
fi
$SUDO tee -a "$CONFIG_PATH" >/dev/null <<EOF
interval: ${INTERVAL}
tls_skip_verify: ${TLS_SKIP}
EOF
log "wrote ${CONFIG_PATH}"

if [ "$HAVE_SYSTEMD" = "true" ]; then
  $SUDO install -m 0644 /dev/null "$SERVICE_PATH"
  $SUDO tee "$SERVICE_PATH" >/dev/null <<EOF
[Unit]
Description=VPS-DOG monitoring agent
Documentation=https://github.com/${REPO}
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${BIN_PATH} -c ${CONFIG_PATH}
Restart=always
RestartSec=5
StartLimitIntervalSec=0
User=root
Environment=VPSDOG_CONFIG=${CONFIG_PATH}
NoNewPrivileges=true
ProtectSystem=full
ProtectHome=true
PrivateTmp=true
ReadWritePaths=${CONFIG_DIR}

[Install]
WantedBy=multi-user.target
EOF
  log "wrote ${SERVICE_PATH}"

  $SUDO systemctl daemon-reload
  $SUDO systemctl enable --now "${BIN_NAME}"

  sleep 1
  if $SUDO systemctl is-active --quiet "${BIN_NAME}"; then
    log "service is running"
    log "check status with: systemctl status ${BIN_NAME}"
    log "follow logs with:  journalctl -u ${BIN_NAME} -f"
  else
    warn "service is not active yet; inspect it with: journalctl -u ${BIN_NAME} -n 50 --no-pager"
    exit 1
  fi
else
  start_background

  sleep 1
  if background_running; then
    log "agent is running detached (pid $(cat "$PID_PATH"))"
    log "follow logs with:  tail -f ${LOG_PATH}"
    log "stop it with:      kill $(cat "$PID_PATH")"
    log "uninstall with:   re-run this script adding -u"
    warn "nothing restarts it after a reboot: no systemd here. Add"
    warn "  ${BIN_PATH} -c ${CONFIG_PATH} &"
    warn "to your container entrypoint / rc.local, or run it under your supervisor."
  else
    warn "the agent does not appear to be running; check ${LOG_PATH}"
    exit 1
  fi
fi
