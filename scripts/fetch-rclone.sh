#!/usr/bin/env bash
set -euo pipefail

# Pinned rclone version for reproducible local/CI installs.
RCLONE_VERSION="${RCLONE_VERSION:-v1.74.3}"
DEST_DIR="${DEST_DIR:-.rclone}"

case "$(uname -s)" in
  Linux)  OS=linux ;;
  Darwin) OS=osx ;;
  *) echo "unsupported OS: $(uname -s)" >&2; exit 1 ;;
esac
case "$(uname -m)" in
  x86_64|amd64) ARCH=amd64 ;;
  arm64|aarch64) ARCH=arm64 ;;
  *) echo "unsupported arch: $(uname -m)" >&2; exit 1 ;;
esac

VER_NO_V="${RCLONE_VERSION#v}"
ZIP="rclone-${RCLONE_VERSION}-${OS}-${ARCH}.zip"
BASE="https://downloads.rclone.org/${RCLONE_VERSION}"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

echo "Downloading ${ZIP}..."
curl -fsSL "${BASE}/${ZIP}" -o "${tmp}/${ZIP}"
curl -fsSL "${BASE}/SHA256SUMS" -o "${tmp}/SHA256SUMS"

echo "Verifying SHA256..."
expected="$(grep "  ${ZIP}\$" "${tmp}/SHA256SUMS" | awk '{print $1}')"
if [ -z "${expected}" ]; then echo "no checksum for ${ZIP}" >&2; exit 1; fi
if command -v sha256sum >/dev/null 2>&1; then
  actual="$(sha256sum "${tmp}/${ZIP}" | awk '{print $1}')"
else
  actual="$(shasum -a 256 "${tmp}/${ZIP}" | awk '{print $1}')"
fi
if [ "${expected}" != "${actual}" ]; then
  echo "checksum mismatch: expected ${expected} got ${actual}" >&2; exit 1
fi

mkdir -p "${DEST_DIR}"
( cd "${tmp}" && unzip -q "${ZIP}" )
cp "${tmp}/rclone-${RCLONE_VERSION}-${OS}-${ARCH}/rclone" "${DEST_DIR}/rclone"
chmod +x "${DEST_DIR}/rclone"
echo "rclone ${RCLONE_VERSION} installed at ${DEST_DIR}/rclone"
