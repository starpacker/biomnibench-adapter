# Source-Native 评测稳定性改造计划

本文档根据当前工作区现状改写之前的完整计划。当前基线为 `915160e`，已完成温度 / thinking 的主要实验控制、Bash cwd 固定、`public/` 写保护和 public integrity guard；后续计划聚焦 `finalize_submission` 语义、submission validation、轨迹清洗和可复现实验日志。

## 目标

- 明确 judge 唯一入口：只有模型成功调用 `finalize_submission`，且提交 validation 通过，才运行 judge。
- 放宽 plan 文件硬门控：缺 plan 只记 warning，不阻断 schema-valid 提交。
- 保留已完成的可复现实验参数：`--temperature` / `--thinking` 可通过 CLI 传递，并在后续补充 effective 状态日志。
- 把输出格式校验抽为公共 submission validator，但只在 `finalize_submission` 被调用时执行。
- 避免 prompt 变硬编码、冗余；基于 harness 已提供的 `<output_contract>`、`<visible_cases>` 和 `<public_files>` 做轻量提醒。
- 保留 raw 轨迹完整性，同时清理 clean 轨迹里的 `"."` 噪声。
- 增强调试记录：run metadata、warnings、validation failures 写入日志和 summary，但不进入模型上下文。

## 当前现状

### 已完成

- CLI 已支持 `--temperature <0..1>`，默认 `1`。
- CLI 已支持 `--thinking disabled|adaptive`，默认 `disabled`。
- `thinking=disabled` 时会把 temperature 传入 QueryEngine / API 请求路径。
- `thinking=adaptive` 时不会发送 temperature，保留 Claude thinking 路径，并在 metadata 中记录 temperature ignored。
- batch worker 已透传 `--temperature` 和 `--thinking`。
- `QueryEngine` / `query.ts` 已支持 `temperatureOverride`。
- source eval 的 Bash 已固定从 run root 启动，Bash `cd` 不再影响后续工具 cwd。
- Bash policy 已加强 `public/` 写保护，覆盖 `cd public/... && mkdir -p workspace/plans` 这类副作用。
- 已增加 public integrity snapshot / diff / restore guard，可把 `public/` mutation 记录为 `trajectory_warning`。
- 已处理 `public/envs/runtime` symlink / junction 场景，避免把 runtime 目录当普通文件或递归扫描。
- `finalize_submission` 已改为 validation pass 才 judge；validation fail 返回可恢复 tool feedback，不消耗 judge round。
- 缺 `workspace/plan.md` 或 `workspace/plans/round_NN.md` 已改为 warning，不阻断 valid submission。
- 已新增共享 `submissionValidator.ts`，覆盖 expected files、npz key、shape、dtype、finite 校验。
- `run_context` / `run_summary.json` / `run_events.jsonl` 已记录 run metadata、warnings、validation attempts。
- clean trajectory 已支持 `trajectory_warning`、validation events、recovery markers，并过滤单独 `"."` / `"..."` 的 assistant text。
- no-finalize recovery prompt 已去掉 `schema-valid files` 表述，只给一次显式 finalize 提醒。
- prompt 已补充轻量 raw keys / shapes / dtypes / finite / range 检查提醒，避免硬编码“必须读某个 JSON 文件”。
- README 已补充 WSL 三任务命令、参数语义、validation 行为和 plan soft gate 行为。
- 当前回归测试已覆盖温度 / thinking、Bash 写保护、public integrity、trajectory warning、task loop、submission validation、run metadata、recovery marker 等路径。
- 当前工作区基线提交：`915160e feat(eval): harden source harness controls`。

### 未完成

- `--thinking enabled` 和 `--thinking-budget-tokens` 尚未实现。
- `temperature=1 --thinking adaptive` 的 thinking baseline 实验尚未跑。

### 暂不纳入本轮必做

- `--thinking enabled` 和 `--thinking-budget-tokens` 尚未实现。当前实验和代码只覆盖 `disabled|adaptive` 两种模式；如果后续确实需要强制 thinking budget，再单独作为 CLI 扩展任务处理。
- `temperature=1 --thinking adaptive` 的 thinking baseline 实验尚未跑；这属于实验验证任务，不阻塞框架语义改造。

## 最终行为语义

### judge 入口

```text
模型调用 finalize_submission
  -> harness 执行 submission validation
    -> validation pass: readyForJudge = true，运行 judge，消耗 1 个 judge round
    -> validation fail: 返回 tool feedback 给模型，不运行 judge，不消耗 judge round
```

明确不做以下自动行为：

```text
outputs/ 存在
  -> harness 自动 validation
  -> harness 自动 finalize
  -> harness 自动 judge
```

### no-finalize recovery

如果模型 turn 结束但没有通过 validation 的 `finalize_submission`：

- harness 只追加一次 recovery prompt。
- recovery 只提醒模型需要显式调用 `finalize_submission`。
- recovery 不运行 validator。
- recovery 不自动提交。
- recovery 不自动 judge。
- 如果 recovery 后仍没有通过 validation 的 `finalize_submission`，当前 run 失败或超时，不运行 judge。

### 防止无限自检

保留现有机制：

- system / initial prompt 要求小实验、尽快提交。
- no-finalize recovery 只给一次。
- `timeoutSeconds` 是全局硬超时。
- `--max-turns-per-round` 可限制单轮 agentic turns。

完整实现回归默认不设置 `--max-turns-per-round`，由 `--timeout-seconds` 兜底；只有诊断 no-finalize loop 或跑短 smoke test 时再显式设置 turn cap。这是运行参数策略，不是自动提交机制。

## 设计决策

### temperature / thinking

当前已实现并保留：

- 默认 `--temperature 1`。
- 默认 `--thinking disabled`。
- `--thinking disabled` 时发送 temperature。
- `--thinking adaptive` 时不发送 temperature。

后续只需要补日志，不改当前请求语义：

- configured temperature。
- effective temperature / temperature sent。
- thinking mode。
- temperature 是否被忽略及原因。

当前不实现隐藏 thinking budget 默认值。若未来支持 `--thinking enabled`，必须显式传 `--thinking-budget-tokens <n>`，未传应 CLI 报错。

### run_context / run_summary

`run_context` / `run_summary` 只写日志，不写入模型 prompt，不占用模型上下文。

写入位置：

- `logs/trajectory.clean.jsonl` 的 `run_context`。
- `logs/run_summary.json`。
- `logs/run_events.jsonl` 的 `run_started.details`。

禁止写入：

- API key。
- full base URL path / query。
- secret env values。
- source prompt 的 `<run_context>`。

### submission validator

抽成小模块，不做大框架。只覆盖当前 source-native 任务需要：

- 输出路径安全。
- expected output files 存在。
- `.npz` required keys。
- shape。
- dtype。
- finite numeric arrays。

触发时机只在模型调用 `finalize_submission` 时。validation fail 是可恢复 tool feedback，不是 task fatal error。

### prompt

不强制写“必须读 `public/output_schema.json` / `visible_data/cases.json`”。

理由：

- harness 已经在 initial prompt 提供 `<output_contract>`、`<visible_cases>`、`<public_files>`。
- 过长 checklist 会增加 token 和行为约束噪声。
- 固定路径强制读取会把 prompt 写死，不利于后续 task bundle 结构变化。

只保留轻量提醒：

- 使用 `<output_contract>` 和 `<visible_cases>` 作为提交 contract。
- 在设计 solver 前检查相关 public case input 的 raw keys / shape / dtype / finite / range，不假设原始数组结构。
- 在 `finalize_submission` 前按同一 contract 做短格式检查。

## 文件变更计划

### 已完成文件

- `src/harness/evaluation/types.ts`
  - 已增加 `EvaluationThinkingMode = 'disabled' | 'adaptive'`。
  - 已增加 `EvaluationLlmOptions`。
  - 已增加 `trajectory_warning` agent event。
- `src/harness/evaluation/cli.ts`
  - 已增加 `--temperature`。
  - 已增加 `--thinking disabled|adaptive`。
  - 默认 `temperature=1`、`thinking=disabled`。
- `src/harness/evaluation/batchRunner.ts`
  - 已透传 `--temperature`、`--thinking`。
- `src/harness/evaluation/sourceLlmOptions.ts`
  - 已集中处理 temperature / thinking 耦合。
- `src/QueryEngine.ts`
  - 已增加 `temperatureOverride`。
- `src/query.ts`
  - 已透传 `temperatureOverride` 到请求路径。
- `src/harness/evaluation/sourceClaudeSessionAgent.ts`
  - 已传入 LLM 参数。
  - 已设置 `fixedShellCwd`。
  - 已接入 public integrity warning。
- `src/harness/evaluation/harnessCanUseTool.ts`
  - 已加强 Bash `public/` 写保护。
- `src/harness/evaluation/sourcePublicIntegrity.ts`
  - 已增加 public snapshot / mutation restore。
- `src/harness/evaluation/sourceTrajectoryWriter.ts`
  - 已支持 `trajectory_warning` clean record。
- `README.md`
  - 已记录 WSL 运行命令、环境变量注入方式和最新参数语义。

### P0-P2 已修改文件

- `src/harness/evaluation/types.ts`
  - 增加 warning、validation issue / result、run metadata 类型。
- `src/harness/evaluation/finalizeSubmissionTool.ts`
  - plan 缺失改 warning。
  - 接入 submission validator。
  - validation fail 返回可恢复 tool feedback。
- `src/harness/evaluation/sourceClaudeSessionAgent.ts`
  - 将 finalize state 中的 warnings / validation result 转为 agent event。
- `src/harness/evaluation/sourceTaskLoop.ts`
  - 处理 validation fail 不 judge、不计 round。
  - 汇总 warnings / validation attempts。
  - 写入 recovery clean markers。
- `src/harness/evaluation/sourceTrajectoryWriter.ts`
  - 增加 clean warning / validation failed / validation passed / recovery marker。
  - clean assistant text 过滤 `"."`。
  - `run_context` 增加 debug metadata。
- `src/harness/evaluation/sourceContextBuilder.ts`
  - 精简数据审计提醒。
  - 修正 recovery prompt。
  - 检查并删除冗余 prompt。
- `src/harness/evaluation/runEventLogger.ts`
  - 增加 `submission_validation_failed`、`submission_validation_passed`、`run_warning` 等 event 类型。
- `README.md`
  - 更新 WSL 命令、参数说明和 finalize validation 语义。

### P0-P1 已新增文件

- `src/harness/evaluation/submissionValidator.ts`
  - 输出文件格式校验。
- `src/harness/evaluation/submissionValidator.test.ts`
  - validator 单测。
- `src/harness/evaluation/runMetadata.ts`
  - debug metadata 收集。
- `src/harness/evaluation/runMetadata.test.ts`
  - metadata 单测。

## 任务拆解

### 任务 1：run metadata 只写日志

文件：

- 新增 `src/harness/evaluation/runMetadata.ts`
- 新增 `src/harness/evaluation/runMetadata.test.ts`
- 修改 `src/harness/evaluation/sourceTaskLoop.ts`
- 修改 `src/harness/evaluation/sourceTrajectoryWriter.ts`

记录字段：

```json
{
  "model": "...",
  "base_url_host": "...",
  "git_commit": "...",
  "git_dirty": false,
  "temperature_configured": 1,
  "temperature_sent": 1,
  "temperature_ignored": false,
  "temperature_ignored_reason": null,
  "thinking_mode": "disabled",
  "thinking_budget_tokens": null
}
```

边界：

- `BASE_URL=https://example.com/v1/api?key=x` 只记录 `example.com`。
- git 命令失败时 `git_commit='unknown'`。
- metadata 不进入 `sourceContextBuilder.ts` 生成的 agent prompt。

验收：

- `run_context`、`run_summary.json`、`run_events.jsonl` 都能看到 metadata。
- initial prompt 不包含 `temperature_configured`、`base_url_host`、`git_commit`。

### 任务 2：抽出 submission validator

文件：

- 新增 `src/harness/evaluation/submissionValidator.ts`
- 新增 `src/harness/evaluation/submissionValidator.test.ts`

触发时机：

- 只在 `finalize_submission` tool 被模型调用时执行。
- 不在 no-finalize recovery 前自动执行。
- 不因为 `outputs/` 存在文件而执行提交逻辑。

职责：

- 路径：`finalize_submission.files` 必须在 `outputs/` 下，禁止 `../` traversal。
- expected files：根据 `public/output_schema.json` 和 `visible_data/cases.json` 计算，expected files 必须存在。
- `.npz` 内容：required key 存在，shape 精确匹配，dtype 符合 schema，`finite_only=true` 时检查 finite。

返回类型：

```ts
export type SubmissionValidationIssue = {
  code:
    | 'missing_output_file'
    | 'path_outside_outputs'
    | 'missing_array_key'
    | 'shape_mismatch'
    | 'dtype_mismatch'
    | 'non_finite_values'
    | 'schema_read_failed'
    | 'cases_read_failed'
    | 'npz_read_failed'
    | 'validator_runtime_failed'
  path?: string
  key?: string
  message: string
  details?: unknown
}

export type SubmissionValidationResult = {
  ok: boolean
  normalizedFiles: string[]
  issues: SubmissionValidationIssue[]
}
```

实现策略：

- TypeScript 负责读取 schema / cases、路径规范化。
- `.npz` 检查用任务 runtime Python + NumPy。
- 使用 `Bun.spawn([runtime.python, scriptPathOrInline])`，不通过 shell。
- Python 输出 JSON，TypeScript 解析。

验收：

- valid npz 通过。
- 缺 output file 失败。
- traversal 失败。
- 缺 key 失败。
- shape mismatch 失败。
- dtype mismatch 失败。
- NaN / Inf 失败。
- validator runtime failure 返回 issue，不 crash harness。

### 任务 3：`finalize_submission` 接入 validator，并放宽 plan 硬门控

文件：

- 修改 `src/harness/evaluation/finalizeSubmissionTool.ts`
- 修改 `src/harness/evaluation/types.ts`
- 测试 `src/harness/evaluation/finalizeSubmissionTool.test.ts`

行为：

- 模型调用 `finalize_submission` 后先收集 plan warnings。
- 执行 submission validation。
- validation pass：
  - `state.readyForJudge = true`
  - 保存 normalized files
  - 保存 warnings
  - tool result 返回成功
- validation fail：
  - `state.readyForJudge = false`
  - 不抛出 task fatal
  - 返回 tool feedback 给模型，要求修复后再次调用 `finalize_submission`

plan 软门控：

- 缺 `workspace/plan.md`：warning，不阻断。
- 缺当前 `workspace/plans/round_NN.md`：warning，不阻断。
- plan 路径非法：hard reject，因为这是 harness 内部状态异常或安全边界问题。

warning 示例：

```json
{
  "kind": "trajectory_warning",
  "round": 1,
  "code": "missing_round_plan",
  "message": "workspace/plans/round_01.md is missing; submission was still judged because outputs are schema-valid."
}
```

validation fail feedback 示例：

```text
finalize_submission validation failed:
- outputs/case_000.npz missing required key reconstruction
- outputs/case_000.npz array reconstruction shape [128,128] != expected [1,128,128]

Fix the outputs and call finalize_submission again.
```

验收：

- plan 缺失 + valid output：finalize 成功，state 带 warning。
- output invalid：finalize 不 ready，返回 validation feedback。
- output invalid 不导致 `tool.call()` 逃逸为未捕获 fatal。
- traversal：拒绝。
- valid output：`readyForJudge=true`。

### 任务 4：`sourceTaskLoop` 处理 validation fail，不消耗 judge round

文件：

- 修改 `src/harness/evaluation/sourceTaskLoop.ts`
- 修改 `src/harness/evaluation/runEventLogger.ts`
- 修改 `src/harness/evaluation/sourceTrajectoryWriter.ts`
- 测试 `src/harness/evaluation/sourceTaskLoop.test.ts`

核心规则：

```text
finalize validation pass:
  judgeRoundsCompleted++
  run judge

finalize validation fail:
  judgeRoundsCompleted 不变
  不 run judge
  继续让 agent 修复，直到 turn 结束或 maxTurns/timeout
```

需要注意：

- 如果 validation fail 作为 tool_result 回到模型，模型可能在同一个 QueryEngine turn 内继续写文件并再次调用 `finalize_submission`。
- `drainAgentTurn()` 应记录每次 validation failed / passed event。
- 只有最后出现的 pass finalize 才让 loop 进入 judge。
- 如果 turn 结束时没有 pass finalize，触发一次 no-finalize recovery。
- recovery 后仍没有 pass finalize，run failed，不 judge。

新增 run events：

- `submission_validation_failed`
- `submission_validation_passed`
- `run_warning`

新增 clean trajectory records：

```json
{"kind":"submission_validation_failed","round":1,"issues":[]}
{"kind":"submission_validation_passed","round":1,"files":["outputs/case_000.npz"]}
{"kind":"trajectory_warning","round":1,"code":"missing_round_plan","message":"..."}
```

验收：

- 第一次 finalize invalid，模型收到反馈后第二次 finalize valid：judge 只跑一次，rounds 为 1。
- invalid finalize 后 agent turn 结束，recovery 中 valid finalize：judge 只跑一次，rounds 为 1。
- invalid finalize 后 recovery 仍不 finalize：run failed，judgeCalls 为 0，rounds 为 0。
- warnings 写入 run events / clean trajectory / run summary。

### 任务 5：no-finalize recovery 保持提醒，不做自动 validation

文件：

- 修改 `src/harness/evaluation/sourceContextBuilder.ts`
- 修改 `src/harness/evaluation/sourceTaskLoop.ts`
- 测试 `src/harness/evaluation/sourceTaskLoop.test.ts`
- 测试 `src/harness/evaluation/sourceContextBuilder.test.ts`

修正 recovery prompt：

```text
Your previous turn ended without finalize_submission.
Do not start new open-ended research or long experiments.
If you believe outputs/ contains valid final files, call finalize_submission now with a concise summary.
If outputs/ is missing or invalid, make only the shortest necessary format fix, then call finalize_submission.
If you cannot create a valid output, briefly explain the blocker and stop.
```

边界：

- recovery 不调用 validator。
- recovery 不自动提交。
- recovery 不自动 judge。
- recovery 只是第二次模型机会。

新增 clean trajectory records：

```json
{"kind":"recovery_started","round":1,"message":"Agent turn ended without finalize_submission; requesting forced closure"}
{"kind":"recovery_finished","round":1,"finalized":true,"summary":"..."}
```

验收：

- recovery prompt 不包含“schema-valid files”这种像 harness 已验证的表述。
- recovery 后仍无 finalize：failed，不 judge。
- clean trajectory 有 recovery markers。

### 任务 6：clean trajectory 过滤 `"."` 噪声

文件：

- 修改 `src/harness/evaluation/sourceTrajectoryWriter.ts`
- 更新 `src/harness/evaluation/sourceTrajectoryWriter.test.ts`

规则：

- raw 永远原样保存。
- clean 过滤 `text.trim()` 只由标点组成且长度 <= 3 的记录。
- `".\n\nNow I understand..."` 去掉开头孤立标点行，保留后面文本。
- 普通文本不变。
- 长文本仍按现有 truncate 规则截断。

函数：

```ts
export function cleanAssistantTextForTrajectory(text: string): string | undefined
```

验收：

- raw 中保留 `"text":"."`。
- clean 中没有单独 `"."`。
- `".\n\nNow I understand"` clean 为 `"Now I understand"`。
- `"This is fine."` 保留。
- truncate 行为不回归。

### 任务 7：精简 prompt 并检查冗余

文件：

- 修改 `src/harness/evaluation/sourceContextBuilder.ts`
- 测试 `src/harness/evaluation/sourceContextBuilder.test.ts`

原则：

- 不强制读固定 JSON 文件路径。
- 不重复长 checklist。
- 基于 harness 提供的 `<output_contract>`、`<visible_cases>`、`<public_files>`。
- 只提醒 raw input inspection。

建议修改：

```text
1. Use <output_contract> and <visible_cases> as the submission contract. Inspect the relevant public case input files before choosing a solver; do not assume raw array keys, shapes, dtypes, finite status, or value ranges.
6. Write final submission files under outputs/ and run a quick local format check against <output_contract>.
```

judge feedback prompt 保持短：

```text
Before finalize_submission, revalidate outputs against the same contract.
```

冗余检查范围：

- `buildSourceSystemPrompt`
- `buildInitialSourcePrompt`
- `buildJudgeFeedbackPrompt`
- `buildNoFinalizeRecoveryPrompt`

验收：

- initial prompt 包含 `<output_contract>`。
- initial prompt 包含 `<visible_cases>`。
- initial prompt 包含 raw keys / shapes / dtypes / finite / ranges 检查提醒。
- prompt 不包含 “must read public/output_schema.json”。
- recovery prompt 不暗示 harness 已验证 schema-valid。

### 任务 8：README 更新

文件：

- 修改 `README.md`

WSL 三任务命令：

```powershell
cd D:\yan1\agent\AutoSkill\my_claude
. .\config\llm-probe.local.ps1

$shareNames = @('API_KEY','BASE_URL','MODEL_NAME','GATEWAY_PROTOCOL','AGENT_LOG_DIR')
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
  --timestamp stability_rerun_wsl_$(date +%Y%m%d_%H%M%S)
'@

wsl -e bash -lc $cmd
```

说明补充：

- `--thinking disabled`：temperature 会实际发送。
- `--thinking adaptive`：temperature 不发送，日志记录 ignored。
- `--max-turns-per-round`：可选限制单个 judge round 内的 agentic turns，用于诊断 no-finalize loop 或短 smoke test。
- `finalize_submission`：validation pass 才 judge；validation fail 反馈给模型修复，不消耗 judge round。
- plan 文件：缺失只 warning，不阻断 valid submission。

### 任务 9：可选实验验证 thinking baseline

目的：

- 排除 temperature 差异后，单独比较 thinking 对通过率和轨迹行为的影响。

已完成一侧：

- `--temperature 1 --thinking disabled`
- 三任务结果：conventional / ct / mri 均 pass，单次运行不显示 no-thinking 明显能力下降。

未完成一侧：

- `--thinking adaptive`，不发送 temperature，等效走 Claude thinking 默认温度路径。

建议命令：

```powershell
$cmd = @'
cd /mnt/d/yan1/agent/AutoSkill/my_claude
export PATH="$HOME/.bun/bin:$PATH"
/home/admin/.bun/bin/bun src/harness/evaluation/cli.ts \
  --task conventional_ptychography \
  --task ct_dual_energy \
  --task mri_grappa \
  --runs-dir output/<output_dir> \
  --max-rounds 5 \
  --timeout-seconds 7200 \
  --temperature 1 \
  --thinking adaptive \
  --timestamp temp1_adaptive_thinking_$(date +%Y%m%d_%H%M%S)
'@

wsl -e bash -lc $cmd
```

## 验证计划

单测总入口：

```bash
bun test src/harness/evaluation/*.test.ts
```

分组测试：

```bash
bun test src/harness/evaluation/cli.test.ts
bun test src/harness/evaluation/batchRunner.test.ts
bun test src/harness/evaluation/sourceLlmOptions.test.ts
bun test src/harness/evaluation/runMetadata.test.ts
bun test src/harness/evaluation/submissionValidator.test.ts
bun test src/harness/evaluation/finalizeSubmissionTool.test.ts
bun test src/harness/evaluation/sourceTaskLoop.test.ts
bun test src/harness/evaluation/sourceTrajectoryWriter.test.ts
bun test src/harness/evaluation/sourceContextBuilder.test.ts
bun test src/harness/evaluation/harnessCanUseTool.test.ts
bun test src/harness/evaluation/sourcePublicIntegrity.test.ts
```

WSL 三任务回归：

```powershell
cd D:\yan1\agent\AutoSkill\my_claude
. .\config\llm-probe.local.ps1

$shareNames = @('API_KEY','BASE_URL','MODEL_NAME','GATEWAY_PROTOCOL','AGENT_LOG_DIR')
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
  --runs-dir output/<output_dir> \
  --max-rounds 5 \
  --timeout-seconds 7200 \
  --temperature 1 \
  --thinking disabled \
  --timestamp stability_rerun_wsl_$(date +%Y%m%d_%H%M%S)
'@

wsl -e bash -lc $cmd
```

## 验收标准

- `--temperature` 默认是 `1`。
- `--thinking` 默认是 `disabled`。
- `--thinking adaptive` 不发送 temperature，并在日志记录 ignored。
- run metadata 只出现在 logs / summary，不进入模型 prompt。
- 缺 `workspace/plan.md` 或当前 round plan 时，valid output 仍可 judge。
- plan warning 写入 run events、clean trajectory、summary。
- 模型调用 `finalize_submission` 且 validation fail 时，不 judge、不消耗 judge round，并给模型明确 tool feedback。
- validation fail 后模型可继续修复并再次调用 `finalize_submission`。
- 模型不调用 `finalize_submission` 时，不自动 validation、不自动 judge，只触发一次 no-finalize recovery。
- clean trajectory 不再保留单独 `"."`。
- raw trajectory 原样保留 `"."`。
- prompt 不硬编码“必须读 output_schema / cases.json”，不明显冗余。
- WSL 三任务命令可直接复现实验参数。

