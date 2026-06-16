#!/bin/bash
set -e

# This script creates the expected Python environment structure for a BioDSBench task

TASK_ID="${1:-25303977_0}"
TASK_DIR="/home/yjh/BioDSBench-imaging101-format/tasks/$TASK_ID"
CONDA_PYTHON="/home/yjh/.conda/envs/biodsbench/bin/python"

if [ ! -d "$TASK_DIR" ]; then
    echo "Error: Task directory not found: $TASK_DIR"
    exit 1
fi

echo "Setting up Python environment for task: $TASK_ID"

# Create the expected directory structure
mkdir -p "$TASK_DIR/envs/runtime/.venv/bin"

# Create a symbolic link to the conda Python
ln -sf "$CONDA_PYTHON" "$TASK_DIR/envs/runtime/.venv/bin/python"
ln -sf "$CONDA_PYTHON" "$TASK_DIR/envs/runtime/.venv/bin/python3"

# Also link pip
CONDA_PIP="/home/yjh/.conda/envs/biodsbench/bin/pip"
ln -sf "$CONDA_PIP" "$TASK_DIR/envs/runtime/.venv/bin/pip"

# Create env_manifest.json if it doesn't exist
if [ ! -f "$TASK_DIR/envs/env_manifest.json" ]; then
    cat > "$TASK_DIR/envs/env_manifest.json" << 'EOF'
{
  "default_env": "runtime",
  "envs": {
    "runtime": {
      "python": {
        "posix": "envs/runtime/.venv/bin/python"
      }
    }
  }
}
EOF
fi

# Generate task_manifest.json if it doesn't exist
if [ ! -f "$TASK_DIR/task_manifest.json" ]; then
    python /home/yjh/my_claude/generate_task_manifest.py "$TASK_ID"
fi

echo "Environment setup complete for task: $TASK_ID"
echo "Python: $TASK_DIR/envs/runtime/.venv/bin/python -> $CONDA_PYTHON"
