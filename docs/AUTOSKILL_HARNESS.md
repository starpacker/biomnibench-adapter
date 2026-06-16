# AutoSkill Source-Native Evaluation Harness

This checkout runs evaluation tasks with the local Claude Code source. The
agent is constructed directly from source. Each task run owns one OS process and one
in-process `QueryEngine` session. Judge feedback is submitted as follow-up
turns to the same session so tool state, conversation state, and file cache are
preserved across judge attempts.

## Run Tasks From WSL

```powershell
cd D:\yan1\agent\AutoSkill\my_claude

. .\config\llm-probe.local.ps1

$shareNames = @(
  'API_KEY',
  'BASE_URL',
  'MODEL_NAME',
  'GATEWAY_PROTOCOL',
  'AGENT_LOG_DIR'
)
$existing = [Environment]::GetEnvironmentVariable('WSLENV')
$add = ($shareNames | ForEach-Object { "$_/u" }) -join ':'
$env:WSLENV = if ($existing) { "$existing`:$add" } else { $add }

$cmd = @'
cd /mnt/d/yan1/agent/AutoSkill/my_claude
export PATH="$HOME/.bun/bin:$PATH"
/home/admin/.bun/bin/bun src/harness/evaluation/cli.ts \
  --task conventional_ptychography \
  --task ct_dual_energy \
  --task mri_grappa \
  --runs-dir output/source-lean-plan-5r \
  --max-rounds 5 \
  --timeout-seconds 7200 \
  --temperature 1 \
  --thinking disabled \
  --timestamp stability_rerun_wsl_env_$(date +%Y%m%d_%H%M%S)
'@

wsl -e bash -lc $cmd
```

Run a single task by keeping only one `--task` line:

```powershell
$cmd = @'
cd /mnt/d/yan1/agent/AutoSkill/my_claude
export PATH="$HOME/.bun/bin:$PATH"
/home/admin/.bun/bin/bun src/harness/evaluation/cli.ts \
  --task mri_grappa \
  --runs-dir output/runs \
  --max-rounds 5 \
  --timeout-seconds 2400 \
  --temperature 1 \
  --thinking disabled
'@

wsl -e bash -lc $cmd
```

## Run Task Batches From Windows

Use `scripts\run-task-batches.ps1` when you want to load a task set from a
config file and run it as a fixed-concurrency pipeline. The script is intended to be run
from Windows PowerShell. It reads `config\task-batch-runner.json`, forwards the
local LLM environment into WSL, and invokes the existing evaluation CLI.

By default, the pipeline keeps up to 3 task workers running at once. When any
worker exits, the next queued task starts immediately; it does not wait for all
3 workers to finish together. Failed or timed-out tasks do not block later tasks,
and the final process exit code is non-zero if any task fails.

```powershell
cd D:\yan1\agent\AutoSkill\my_claude

powershell -NoProfile -ExecutionPolicy Bypass `
  -File scripts\run-task-batches.ps1
```

Preview the pipeline plan and generated WSL command without running tasks:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass `
  -File scripts\run-task-batches.ps1 `
  -DryRun
```

Emit the dry-run plan as JSON:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass `
  -File scripts\run-task-batches.ps1 `
  -DryRun `
  -PlanJson
```

You can also point the script at another config file:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass `
  -File scripts\run-task-batches.ps1 `
  -ConfigPath config\my-task-set.json
```

### General Batch Config

`config\task-batch-runner.json` controls which tasks are run and how the
evaluation CLI is called:

```json
{
  "tasks": [
    "task_a",
    "task_b",
    "task_c",
    "task_d"
  ],
  "batchSize": 3,
  "tasksDir": "tasks",
  "runsDir": "output/runs",
  "maxRounds": 5,
  "timeoutSeconds": 7200,
  "workerTimeoutGraceSeconds": 60,
  "temperature": 1,
  "thinking": "disabled",
  "timestampPrefix": "manual_rerun",
  "continueOnFailure": true,
  "loadLocalConfig": true,
  "bunPath": "/home/admin/.bun/bin/bun"
}
```

Key fields:

- `tasks`: task IDs under `tasks/`, in the order they should run.
- `batchSize`: maximum number of task workers running at the same time.
- `runsDir`: run artifact directory passed to `--runs-dir`.
- `maxRounds`, `timeoutSeconds`, `temperature`, `thinking`: forwarded to the
  evaluation CLI.
- `workerTimeoutGraceSeconds`: extra time allowed for a timed-out worker to
  shut down before the batch runner kills it.
- `timestampPrefix`: prefix for the shared pipeline `--timestamp` value.
- `continueOnFailure`: defaults to `true`; failed tasks are recorded but do not
  stop queued tasks from running.
- `loadLocalConfig`: load `config\llm-probe.local.ps1` before running when
  `true`.
- `bunPath`: Bun executable path inside WSL.

### Example: Rerun `mri_sense` and `mri_tv`

Create a small config such as `config\mri-rerun.json`:

```json
{
  "tasks": [
    "mri_sense",
    "mri_tv"
  ],
  "batchSize": 3,
  "tasksDir": "tasks",
  "runsDir": "output/runs",
  "maxRounds": 5,
  "timeoutSeconds": 7200,
  "workerTimeoutGraceSeconds": 60,
  "temperature": 1,
  "thinking": "disabled",
  "timestampPrefix": "mri_sense_tv_rerun",
  "continueOnFailure": true,
  "loadLocalConfig": true,
  "bunPath": "/home/admin/.bun/bin/bun"
}
```

Then run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass `
  -File scripts\run-task-batches.ps1 `
  -ConfigPath config\mri-rerun.json
```

The PowerShell bootstrap is required for local runs that depend on
`config/llm-probe.local.ps1`. `WSLENV` forwards the local LLM variables into
WSL; running the same CLI directly from Windows or without the forwarded
environment can fail before the agent starts.

Default source-native runs use `--thinking disabled` and `--temperature 1`.
When thinking is disabled, the configured temperature is sent to the model.
When `--thinking adaptive` is selected, temperature is intentionally not sent
and `run_metadata` records it as ignored. `--max-turns-per-round` is optional:
leave it unset for full implementation regressions, or set it when you need a
strict cap while diagnosing no-finalize loops. `--timeout-seconds` remains the
whole-run hard timeout.

`finalize_submission` is the only path that can trigger the judge. The harness
validates submitted `outputs/` files against the public output contract first:
a validation pass proceeds to the judge, while a validation failure returns
recoverable tool feedback to the agent and does not consume a judge round.
Missing `workspace/plan.md` or round plan files are warnings only; they do not
block an otherwise valid submission.

## Architecture

- `src/harness/evaluation/cli.ts` parses CLI args and calls `runSourceTaskLoop`.
- `sourceTaskLoop.ts` creates the run directory, resolves runtime, owns judge rounds, and writes summaries.
- `sourceClaudeSessionAgent.ts` constructs Claude source `QueryEngine` directly and reuses it for the whole run.
- `harnessCanUseTool.ts` enforces run-local permissions for Claude source tools.
- `finalizeSubmissionTool.ts` provides the in-process ready signal used to trigger the judge.
- `sourceTrajectoryWriter.ts` writes compact clean JSONL plus raw debug JSONL.
- Repeating `--task` dispatches one source-only worker process per task.

Removed legacy paths include old driver layers, bridge servers, bootstrap shims, redundant sandbox wrappers, and old full-history trajectory code.

## Runtime

The harness verifies the task Python before agent startup by reading
`public/envs/env_manifest.json` or conventional runtime paths under
`public/envs/runtime/`. If no runtime is found, the run exits as `infra_error`
and the agent is not asked to repair virtual environments.

Runtime virtual-environment directories are linked into each run instead of
copied, which avoids duplicating large `site-packages` trees.

## Outputs

Run artifacts are written under `output/runs/<task_id>_<timestamp>/`:

- `public/`: copied public task bundle.
- `workspace/`: agent scratch/code.
- `outputs/`: final files passed to the judge.
- `logs/run_events.jsonl`: concise run events.
- `logs/trajectory.clean.jsonl`: training-friendly trajectory.
- `logs/trajectory.raw.jsonl`: raw source event stream.
- `logs/run_summary.json`: final status summary.

Clean trajectories include structured validation events, warning records, and
no-finalize recovery markers. Raw trajectories preserve source events exactly,
including punctuation-only assistant text that clean trajectories filter out.
