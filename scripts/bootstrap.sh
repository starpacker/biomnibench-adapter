#!/usr/bin/env bash
# BioMniBench Adapter — one-shot bootstrap.
#
# Performs everything a fresh clone needs to start running tasks:
#   1. Verifies bun + python3 are available.
#   2. Installs Bun deps (package.json).
#   3. Installs Python deps (requirements.txt).
#   4. Hydrates task data from the upstream HuggingFace dataset.
#
# Usage:   ./scripts/bootstrap.sh            (hydrate all 50 tasks)
#          ./scripts/bootstrap.sh da-1-3 da-9-1   (subset)
#
# Required env vars:
#   HF_TOKEN          your HuggingFace token (the upstream dataset is gated).
#                     Get one at https://huggingface.co/settings/tokens.
# Optional:
#   HF_ENDPOINT       defaults to https://huggingface.co; set to
#                     https://hf-mirror.com if HF is blocked in your region.
#   DATASET_DIR       where to clone the dataset (default: ./biomnibench-data).
#   DATASET_REPO      override dataset repo (default: starpacker52/biomnibench-organized).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATASET_DIR="${DATASET_DIR:-$ROOT/biomnibench-data}"
DATASET_REPO="${DATASET_REPO:-starpacker52/biomnibench-organized}"
HF_ENDPOINT="${HF_ENDPOINT:-https://huggingface.co}"

step() { printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m  ! %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

# 1. Tool checks ------------------------------------------------------------
step "Checking prerequisites"
command -v bun     >/dev/null || die "bun not found. Install: curl -fsSL https://bun.sh/install | bash"
command -v python3 >/dev/null || die "python3 not found."
command -v git     >/dev/null || die "git not found."
echo "  bun:    $(bun --version)"
echo "  python: $(python3 --version)"

# 2. Bun deps --------------------------------------------------------------
step "Installing Bun dependencies"
cd "$ROOT"
bun install --frozen-lockfile 2>&1 | tail -3

# 3. Python deps -----------------------------------------------------------
step "Installing Python dependencies"
python3 -m pip install --user --quiet --upgrade pip
python3 -m pip install --user --quiet -r "$ROOT/requirements.txt"
echo "  installed huggingface_hub + judge SDKs"

# 4. Pull dataset repo (metadata + per-task harness) ------------------------
step "Cloning dataset repo $DATASET_REPO"
if [[ ! -d "$DATASET_DIR/.git" ]]; then
    if [[ -n "${HF_TOKEN:-}" ]]; then
        git clone "https://oauth2:${HF_TOKEN}@${HF_ENDPOINT#https://}/datasets/$DATASET_REPO" "$DATASET_DIR"
    else
        git clone "$HF_ENDPOINT/datasets/$DATASET_REPO" "$DATASET_DIR"
    fi
else
    echo "  $DATASET_DIR already exists — pulling latest"
    (cd "$DATASET_DIR" && git pull --ff-only)
fi

# 5. Hydrate raw data from upstream HF dataset -----------------------------
step "Hydrating raw biomedical data from phylobio/BiomniBench-DA"
[[ -z "${HF_TOKEN:-}" ]] && warn "HF_TOKEN is unset. The upstream dataset is gated; set HF_TOKEN to download."

if [[ $# -gt 0 ]]; then
    HF_TOKEN="${HF_TOKEN:-}" HF_ENDPOINT="$HF_ENDPOINT" \
        python3 "$DATASET_DIR/download_data.py" --hydrate-from-hf --tasks "$@"
else
    HF_TOKEN="${HF_TOKEN:-}" HF_ENDPOINT="$HF_ENDPOINT" \
        python3 "$DATASET_DIR/download_data.py" --hydrate-from-hf
fi

step "Done"
cat <<EOF

  Framework:  $ROOT
  Dataset:    $DATASET_DIR

  Try a single task:
    bun src/cli.ts run --task da-9-1 --dataset $DATASET_DIR

EOF
