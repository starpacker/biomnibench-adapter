#!/bin/bash
set -e

# Load LLM configuration
source /home/yjh/my_claude/config/llm-config.sh

# Set up paths
REPO_DIR="/home/yjh/my_claude"
BUN_PATH="/home/yjh/.bun/bin/bun"

# Configuration
TASK_ID="${1:-25303977_0}"  # Default to first task if not specified
TASKS_DIR="tasks"
RUNS_DIR="output/Bio_runs"
MAX_ROUNDS=5
TIMEOUT_SECONDS=7200
TEMPERATURE=1
THINKING="disabled"

# Create output directory
mkdir -p "$REPO_DIR/$RUNS_DIR"

# Set up task environment if not already done
echo "Setting up task environment..."
/home/yjh/my_claude/setup_task_env.sh "$TASK_ID"

# Run evaluation
cd "$REPO_DIR"
export PATH="$HOME/.bun/bin:$PATH"

echo ""
echo "Running BioDSBench evaluation for task: $TASK_ID"
echo "Model: $MODEL_NAME"
echo "Base URL: $BASE_URL"
echo "Output directory: $RUNS_DIR"
echo ""

$BUN_PATH src/harness/evaluation/cli.ts \
  --task "$TASK_ID" \
  --tasks-dir "$TASKS_DIR" \
  --runs-dir "$RUNS_DIR" \
  --max-rounds $MAX_ROUNDS \
  --timeout-seconds $TIMEOUT_SECONDS \
  --temperature $TEMPERATURE \
  --thinking $THINKING \
  --agent-runtime source

echo ""
echo "Evaluation completed. Results saved to: $RUNS_DIR"
