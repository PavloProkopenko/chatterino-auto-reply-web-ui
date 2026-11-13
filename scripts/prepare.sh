#!/usr/bin/env bash
# Prepare a developer machine (macOS/Linux): portable Node + pinned pnpm into ./.tools, dependencies from the
# lockfile, then lint, unit tests, vendor drift check and a build smoke test. Idempotent, no admin rights.
#   scripts/prepare.sh            do everything
#   scripts/prepare.sh --check    only report what is missing
#   scripts/prepare.sh --ci       same as default (the script never prompts)
set -euo pipefail

NODE_VERSION="22.17.0"
SHA_darwin_arm64="615dda58b5fb41fad2be43940b6398ca56554cbe05800953afadc724729cb09e"
SHA_darwin_x64="c39c8ec3cdadedfcc75de0cb3305df95ae2aecebc5db8d68a9b67bd74616d2ad"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TOOLS="$ROOT/.tools"
CHECK=0; [[ "${1:-}" == "--check" ]] && CHECK=1
PNPM_VERSION="$(sed -n 's/.*"packageManager": "pnpm@\([^"]*\)".*/\1/p' "$ROOT/package.json")"
missing=()

node_ok() { command -v node >/dev/null && [[ "$(node -p 'process.versions.node.split(".")[0]')" -ge 22 ]]; }

# --- Node ---
if [[ -x "$TOOLS/node/bin/node" ]]; then export PATH="$TOOLS/node/bin:$PATH"; fi
if ! node_ok; then
  if [[ $CHECK -eq 1 ]]; then missing+=("Node >= 22"); else
    case "$(uname -s)-$(uname -m)" in
      Darwin-arm64) plat=darwin-arm64; sha="$SHA_darwin_arm64" ;;
      Darwin-x86_64) plat=darwin-x64; sha="$SHA_darwin_x64" ;;
      *) echo "Unsupported platform $(uname -s)-$(uname -m): install Node >= 22 yourself." >&2; exit 1 ;;
    esac
    mkdir -p "$TOOLS"
    tgz="$TOOLS/node-v$NODE_VERSION-$plat.tar.gz"
    curl -fsSL "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-$plat.tar.gz" -o "$tgz"
    echo "$sha  $tgz" | shasum -a 256 -c - >/dev/null || { echo "SHA-256 mismatch for Node archive" >&2; rm -f "$tgz"; exit 1; }
    rm -rf "$TOOLS/node"; mkdir -p "$TOOLS/node"
    tar -xzf "$tgz" -C "$TOOLS/node" --strip-components=1; rm -f "$tgz"
    export PATH="$TOOLS/node/bin:$PATH"
  fi
fi

# --- pnpm (npm-installed into ./.tools; pnpm 12 ships a native binary that corepack 0.33 cannot launch) ---
PNPM="$TOOLS/pnpm/node_modules/.bin/pnpm"
if [[ ! -x "$PNPM" || "$("$PNPM" --version 2>/dev/null || true)" != "$PNPM_VERSION" ]]; then
  if [[ $CHECK -eq 1 ]]; then missing+=("pnpm $PNPM_VERSION in .tools"); else
    mkdir -p "$TOOLS/pnpm"
    npm install --prefix "$TOOLS/pnpm" "pnpm@$PNPM_VERSION" --no-audit --no-fund --loglevel=error
  fi
fi

[[ -d "$ROOT/node_modules" ]] || missing+=("dependencies (pnpm install)")
if [[ $CHECK -eq 1 ]]; then
  if ((${#missing[@]})); then printf 'Missing:\n  - %s\n' "${missing[@]}"; exit 1; fi
  echo "Everything is in place."; exit 0
fi

cd "$ROOT"
"$PNPM" install --frozen-lockfile
"$PNPM" lint
"$PNPM" typecheck
"$PNPM" test
"$PNPM" sync-plugin:check
"$PNPM" build:smoke
echo
echo "Ready. Use:  export PATH=\"$TOOLS/node/bin:$TOOLS/pnpm/node_modules/.bin:\$PATH\"  then  pnpm test"
