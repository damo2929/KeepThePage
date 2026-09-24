#!/usr/bin/env bash
# Keep The Page — unit tests. There is no node on this box, so these run on gjs.
set -u
cd "$(dirname "$0")"
command -v gjs >/dev/null || { echo "gjs not found (needed to run the tests)"; exit 127; }
exec gjs tests/run.js "$(pwd)"
