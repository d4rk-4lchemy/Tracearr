#!/usr/bin/env sh
# Extracts the stream map basemap from the Protomaps daily planet build.
# Usage: scripts/fetch-basemap.sh [output path]
# BASEMAP_MAXZOOM overrides the zoom ceiling; BASEMAP_BUILD can pin an
# YYYYMMDD build. Unpinned downloads try the three newest published v4 basemaps.
set -eu

MAXZOOM=${BASEMAP_MAXZOOM:-8}
PMTILES_VERSION=1.31.2
OUT=${1:-data/basemap.pmtiles}
tmp=
partial=
cleanup() {
  if [ -n "$partial" ]; then rm -f "$partial"; fi
  if [ -n "$tmp" ]; then rm -rf "$tmp"; fi
}
trap cleanup EXIT

BUILD=${BASEMAP_BUILD:-}
if [ -z "$BUILD" ]; then
  builds=$(curl -fsSL https://build-metadata.protomaps.dev/builds.json | node -e '
    let body = "";
    process.stdin.on("data", (chunk) => { body += chunk; });
    process.stdin.on("end", () => {
      try {
        const builds = JSON.parse(body);
        const latest = builds
          .filter((build) => /^\d{8}\.pmtiles$/.test(build.key) && /^4\./.test(build.version))
          .sort((a, b) => b.key.localeCompare(a.key)).slice(0, 3);
        if (!latest.length) throw new Error("no published v4 basemap found");
        process.stdout.write(latest.map((build) => build.key.slice(0, 8)).join("\n"));
      } catch (error) {
        console.error(`Could not select a Protomaps basemap: ${error.message}`);
        process.exitCode = 1;
      }
    });
  ')
else
  case "$BUILD" in
    ????????)
      case "$BUILD" in *[!0-9]*) echo "BASEMAP_BUILD must be YYYYMMDD" >&2; exit 1 ;; esac
      ;;
    *) echo "BASEMAP_BUILD must be YYYYMMDD" >&2; exit 1 ;;
  esac
  builds=$BUILD
fi

if command -v pmtiles >/dev/null 2>&1; then
  PMTILES=pmtiles
else
  os=$(uname -s)
  arch=$(uname -m)
  case "$arch" in aarch64) arch=arm64 ;; esac
  tmp=$(mktemp -d)
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
partial="${OUT}.tmp.$$"
for build in $builds; do
  if "$PMTILES" extract "https://build.protomaps.com/$build.pmtiles" "$partial" --maxzoom="$MAXZOOM"; then
    mv "$partial" "$OUT"
    partial=
    echo "basemap: Protomaps build $build, zoom 0-$MAXZOOM"
    exit 0
  fi
  rm -f "$partial"
  echo "Protomaps build $build failed" >&2
done
echo "could not extract a basemap from Protomaps builds: $builds" >&2
exit 1
