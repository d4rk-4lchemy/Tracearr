#!/usr/bin/env sh
# Extracts the stream map basemap from the Protomaps daily planet build.
# Usage: scripts/fetch-basemap.sh [output path]
# BASEMAP_MAXZOOM overrides the zoom ceiling; CI caches on this file's hash,
# so bumping BUILD here is what rolls the archive forward.
set -eu

BUILD=20260926
MAXZOOM=${BASEMAP_MAXZOOM:-8}
PMTILES_VERSION=1.31.2
OUT=${1:-data/basemap.pmtiles}

if command -v pmtiles >/dev/null 2>&1; then
  PMTILES=pmtiles
else
  os=$(uname -s)
  arch=$(uname -m)
  case "$arch" in aarch64) arch=arm64 ;; esac
  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' EXIT
  base=https://github.com/protomaps/go-pmtiles/releases/download/v$PMTILES_VERSION
  case "$os" in
    Linux)
      curl -fsSL "$base/go-pmtiles_${PMTILES_VERSION}_Linux_${arch}.tar.gz" | tar -xz -C "$tmp" pmtiles
      ;;
    Darwin)
      curl -fsSL -o "$tmp/pmtiles.zip" "$base/go-pmtiles-${PMTILES_VERSION}_Darwin_${arch}.zip"
      unzip -q "$tmp/pmtiles.zip" pmtiles -d "$tmp"
      ;;
    *)
      echo "no pmtiles build for $os; install one from $base and put it on PATH" >&2
      exit 1
      ;;
  esac
  PMTILES=$tmp/pmtiles
fi

mkdir -p "$(dirname "$OUT")"
"$PMTILES" extract "https://build.protomaps.com/$BUILD.pmtiles" "$OUT" --maxzoom="$MAXZOOM"
