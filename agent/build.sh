#!/usr/bin/env bash
# Cross-compile the VPS-DOG agent for every supported platform.
#
#   ./build.sh            # version defaults to the one in version.go
#   ./build.sh 1.2.3      # stamp an explicit version
#
# Output: dist/<name>-<os>-<arch>[.exe]
set -euo pipefail

cd "$(dirname "$0")"

VERSION="${1:-}"
if [ -z "$VERSION" ]; then
  VERSION="$(sed -n 's/.*Version = "\(.*\)".*/\1/p' version.go | head -n1)"
fi
if [ -z "$VERSION" ]; then
  echo "build.sh: could not determine version" >&2
  exit 1
fi

LDFLAGS="-s -w -X main.Version=${VERSION}"
OUT="dist"
mkdir -p "$OUT"

# target list: GOOS/GOARCH[/GOARM]
TARGETS="
linux/amd64
linux/arm64
linux/arm/7
linux/386
darwin/amd64
darwin/arm64
windows/amd64
"

echo "building vps-dog ${VERSION} (CGO_ENABLED=0)"
for target in $TARGETS; do
  GOOS="${target%%/*}"
  rest="${target#*/}"
  GOARCH="${rest%%/*}"
  GOARM=""
  case "$rest" in
    */*) GOARM="${rest#*/}" ;;
  esac

  ext=""
  if [ "$GOOS" = "windows" ]; then ext=".exe"; fi

  name="vps-dog-${GOOS}-${GOARCH}"
  if [ -n "$GOARM" ]; then name="${name}v${GOARM}"; fi
  name="${name}${ext}"

  printf '  %-28s' "$name"
  CGO_ENABLED=0 GOOS="$GOOS" GOARCH="$GOARCH" GOARM="$GOARM" \
    go build -trimpath -ldflags "$LDFLAGS" -o "${OUT}/${name}" .
  echo "ok"
done

echo
echo "artifacts in ${OUT}/:"
ls -lh "$OUT"
