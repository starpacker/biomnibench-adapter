# Evaluation Timeout Exit Fix 实施计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 修复批量任务在 worker 已记录 `run_finished timeout` 后仍不退出，导致 Windows 批处理脚本无法进入下一批、也无法结束的问题。

**架构：** 将 timeout 从“只让等待方超时”升级为“主动取消 worker 内部执行并保证父进程有兜底”。核心路径是 source worker：`drainAgentTurn()` 超时时关闭 async generator，`SourceClaudeSessionAgent.dispose()` 中断 `QueryEngine`，worker CLI 按最终状态返回非零退出码；batch 父进程改为固定并发池调度（默认 3 个 worker），任一 worker 结束就立即补上下一个任务，同时增加 watchdog，避免任何单个 worker 清理失败拖死整条流水线。

**技术栈：** TypeScript、Bun test、PowerShell batch runner、WSL。

---

## 根因结论

日志显示两个 worker 都已经写出：

- `agent_step_error`: `Agent inference timed out`
- `run_finished`: `Run finished with status timeout`

但外层 `scripts/run-task-batches.ps1` 没继续下一批，是因为它在 `scripts/run-task-batches.ps1:213` 等待 `wsl.exe -e bash -lc $batch.command` 返回；该 WSL 命令里的 batch CLI 又在 `src/harness/evaluation/batchRunner.ts:72` 等所有 worker 的 `child.exited`。worker 虽然完成了逻辑状态记录，但进程仍被未取消的 async generator、模型流、工具执行或其他 active handle 拖住。

关键证据：

- `src/harness/evaluation/sourceTaskLoop.ts:37` 的 `withTimeout()` 只是 `Promise.race()`，超时后不会取消原始 `events.next()`。
- `src/harness/evaluation/sourceTaskLoop.ts:150` 的 `drainAgentTurn()` 超时路径没有调用 `events.return?.()`。
- `src/harness/evaluation/sourceTaskLoop.ts:491` 只调用 `session.dispose?.()`，但真实的 `SourceClaudeSessionAgent` 没实现 `dispose()`。
- `src/QueryEngine.ts:1167` 已有 `interrupt()` 可触发内部 `AbortController`，但 evaluation harness 没调用。
- `src/harness/evaluation/cli.ts:246` 的 worker 路径输出 JSON 后没有按 `result.status` 设置 `process.exitCode`。
- `src/harness/evaluation/batchRunner.ts:63` 的 worker spawn 没有 watchdog；任一 worker 不退出，父 batch 永久等待。

新增调度要求：

- `continueOnFailure` 的默认值为 `true`，且当前需求不需要 `false` 的“失败即停止”行为。
- `batchSize` 表示最大并发数，而不是固定分批边界。
- 调度方式应为流水线：最多同时运行 `batchSize` 个 worker；只要任意 worker 结束，马上启动任务队列中的下一个任务；直到所有任务都已启动并结束。
- 单个任务失败或 timeout 不阻塞后续任务；最终汇总 `ok=false`，整体退出码非 0。

## 计划文件职责

- 修改 `src/harness/evaluation/types.ts`：扩展 source session 生命周期接口。
- 修改 `src/harness/evaluation/sourceTaskLoop.ts`：让 timeout 主动关闭 generator，并给 dispose 加 bounded grace。
- 修改 `src/harness/evaluation/sourceClaudeSessionAgent.ts`：实现幂等 dispose，中断 `QueryEngine`。
- 修改 `src/harness/evaluation/cli.ts`：worker 单任务路径按结果设置退出码。
- 修改 `src/harness/evaluation/batchRunner.ts`：实现固定并发池、失败继续、worker watchdog 和 kill 兜底。
- 修改 `src/harness/evaluation/sourceTaskLoop.test.ts`：覆盖 timeout 关闭 generator / dispose。
- 修改 `src/harness/evaluation/batchRunner.test.ts`：覆盖流水线补位、失败继续和 worker 超时 watchdog。
- 修改 `src/harness/evaluation/cli.test.ts` 或新增 CLI 子进程测试：覆盖 timeout / failed 退出码。
- 修改 `scripts/run-task-batches.ps1` 和 `tests/test_task_batch_runner.py`：不再把任务切成固定批次；将完整任务集合交给 CLI，并把 `batchSize` 作为最大并发数透传。
- 修改 `README.md`：说明 `continueOnFailure` 默认为 `true`，以及 `batchSize` 是最大并发数，不是固定批次大小。

---

### 任务 1：为 SourceAgentSession 增加主动中断语义

**文件：**
- 修改：`src/harness/evaluation/types.ts`

- [ ] **步骤 1：扩展接口**

将 `SourceAgentSession` 从只有 `submit()` / `dispose()` 扩展为支持可选 `interrupt()`。`dispose()` 仍保留，用于最终清理。

```ts
export type SourceAgentSession = {
  submit(input: SourceAgentTurnInput): AsyncGenerator<SourceAgentEvent, void, unknown>
  interrupt?(reason?: string): void
  dispose?(): Promise<void>
}
```

- [ ] **步骤 2：运行类型检查或相关测试**

运行：

```powershell
bun test src/harness/evaluation/sourceTaskLoop.test.ts
```

预期：如果只有类型接口变更，现有 mock 不需要实现 `interrupt()`，测试仍应通过。

---

### 任务 2：超时时关闭 agent generator 并中断 session

**文件：**
- 修改：`src/harness/evaluation/sourceTaskLoop.ts`
- 测试：`src/harness/evaluation/sourceTaskLoop.test.ts`

- [ ] **步骤 1：编写失败测试：timeout 后 async generator 的 finally 被执行**

在 `sourceTaskLoop.test.ts` 中新增测试。构造一个永不产生下一条事件的 generator，并在 `finally` 中标记已关闭：

```ts
test('closes agent event generator when agent inference times out', async () => {
  const root = await mkdtemp(join(tmpdir(), 'source-loop-timeout-close-'))
  const tasksDir = join(root, 'tasks')
  const runsDir = join(root, 'runs')
  await makeTask(tasksDir, 'timeout_close_task', true)
  let generatorClosed = false
  let interrupted = false
  let disposed = false

  async function* hangingSubmit() {
    try {
      await new Promise(() => {})
    } finally {
      generatorClosed = true
    }
  }

  const result = await runSourceTaskLoop({
    taskId: 'timeout_close_task',
    tasksDir,
    runsDir,
    maxRounds: 1,
    timeoutSeconds: 1,
    sessionFactory: async () => ({
      submit: hangingSubmit,
      interrupt() {
        interrupted = true
      },
      async dispose() {
        disposed = true
      },
    }),
    judge: {
      async run() {
        throw new Error('judge should not run')
      },
    },
  })

  expect(result.status).toBe('timeout')
  expect(generatorClosed).toBe(true)
  expect(interrupted).toBe(true)
  expect(disposed).toBe(true)
})
```

运行：

```powershell
bun test src/harness/evaluation/sourceTaskLoop.test.ts -t "closes agent event generator"
```

预期：当前实现失败，因为 `events.return?.()` 和 `session.interrupt?.()` 尚未执行。

- [ ] **步骤 2：让 `drainAgentTurn()` 在 timeout 时关闭 generator**

在 `sourceTaskLoop.ts` 中增加可识别 timeout 的错误类型或 helper：

```ts
function isTimeoutError(error: unknown): boolean {
  return errorMessage(error).includes('timed out')
}
```

将 `drainAgentTurn()` 的 `withTimeout(input.events.next(), ...)` 包在 `try/catch` 中，超时或异常时都尝试关闭 generator：

```ts
try {
  const next = await withTimeout(
    input.events.next(),
    remainingMilliseconds(input.deadline),
    'Agent inference',
  )
  if (next.done) break
  // existing event handling...
} catch (error) {
  try {
    await input.events.return?.()
  } catch {
    // Best-effort generator close; preserve the original timeout/error.
  }
  throw error
}
```

- [ ] **步骤 3：在 `runSourceTaskLoop()` timeout catch 中中断 session**

在 `catch` 分支里，如果是 timeout，调用：

```ts
if (isTimeoutError(error)) {
  session.interrupt?.('timeout')
}
```

保留 `finalStatus = 'timeout'` 逻辑。

- [ ] **步骤 4：验证测试转绿**

运行：

```powershell
bun test src/harness/evaluation/sourceTaskLoop.test.ts -t "closes agent event generator"
```

预期：新增测试通过。

---

### 任务 3：给 session dispose 加有界等待，避免清理自身卡住

**文件：**
- 修改：`src/harness/evaluation/sourceTaskLoop.ts`
- 测试：`src/harness/evaluation/sourceTaskLoop.test.ts`

- [ ] **步骤 1：编写失败测试：dispose 卡住时 runSourceTaskLoop 仍返回**

新增测试，`dispose()` 返回永不 resolve 的 Promise，期望函数仍能在短 grace 后返回 timeout：

```ts
test('does not hang forever when session dispose never resolves', async () => {
  const root = await mkdtemp(join(tmpdir(), 'source-loop-dispose-hang-'))
  const tasksDir = join(root, 'tasks')
  const runsDir = join(root, 'runs')
  await makeTask(tasksDir, 'dispose_hang_task', true)

  const result = await runSourceTaskLoop({
    taskId: 'dispose_hang_task',
    tasksDir,
    runsDir,
    maxRounds: 1,
    timeoutSeconds: 1,
    sessionFactory: async () => ({
      async *submit() {
        await new Promise(() => {})
      },
      async dispose() {
        await new Promise(() => {})
      },
    }),
    judge: {
      async run() {
        throw new Error('judge should not run')
      },
    },
  })

  expect(result.status).toBe('timeout')
})
```

运行：

```powershell
bun test src/harness/evaluation/sourceTaskLoop.test.ts -t "dispose never resolves"
```

预期：当前实现会挂住，测试失败或超时。

- [ ] **步骤 2：实现 bounded dispose helper**

在 `sourceTaskLoop.ts` 中添加：

```ts
const SESSION_DISPOSE_GRACE_MS = 5000

async function disposeSessionWithTimeout(
  session: SourceAgentSession,
  eventLogger: RunEventLogger,
): Promise<void> {
  if (!session.dispose) return
  try {
    await withTimeout(session.dispose(), SESSION_DISPOSE_GRACE_MS, 'Session dispose')
  } catch (error) {
    await eventLogger.log('run_warning', {
      message: `Session dispose did not finish cleanly: ${errorMessage(error)}`,
      details: { code: 'session_dispose_timeout' },
    })
  }
}
```

把 finally 中的：

```ts
await session.dispose?.()
```

替换为：

```ts
await disposeSessionWithTimeout(session, eventLogger)
```

- [ ] **步骤 3：验证测试转绿**

运行：

```powershell
bun test src/harness/evaluation/sourceTaskLoop.test.ts -t "dispose never resolves"
```

预期：测试在 grace 后通过。若 5 秒太慢，可把 helper 支持测试注入 grace；没有注入时生产默认 5000 ms。

---

### 任务 4：在 SourceClaudeSessionAgent 中真正中断 QueryEngine

**文件：**
- 修改：`src/harness/evaluation/sourceClaudeSessionAgent.ts`
- 可选测试：新增 `src/harness/evaluation/sourceClaudeSessionAgent.test.ts`

- [ ] **步骤 1：实现幂等 `interrupt()` 和 `dispose()`**

在类中新增字段：

```ts
private disposed = false
```

实现：

```ts
interrupt(): void {
  this.engine.interrupt()
}

async dispose(): Promise<void> {
  if (this.disposed) return
  this.disposed = true
  this.engine.interrupt()
}
```

说明：`QueryEngine.interrupt()` 目前是同步 abort，足以触发 `src/query.ts:661` 使用的 abort signal；如果后续 QueryEngine 增加 async cleanup，再扩展这里。

- [ ] **步骤 2：编写单元测试或轻量 mock 测试**

如果 `SourceClaudeSessionAgent` 构造成本过高，不强行实例化真实 QueryEngine。可将 `QueryEngine` 注入做成可选工厂，但这会扩大改动面；优先通过 `sourceTaskLoop.test.ts` 的 session mock 覆盖生命周期语义。

- [ ] **步骤 3：运行 source loop 测试**

运行：

```powershell
bun test src/harness/evaluation/sourceTaskLoop.test.ts
```

预期：全部通过。

---

### 任务 5：worker CLI 按最终状态返回退出码

**文件：**
- 修改：`src/harness/evaluation/cli.ts`
- 测试：`src/harness/evaluation/cli.test.ts`

- [ ] **步骤 1：抽出状态到退出码 helper**

在 `cli.ts` 中新增导出函数：

```ts
export function exitCodeForLoopStatus(status: string): number {
  return status === 'success' ? 0 : 1
}
```

- [ ] **步骤 2：单任务 worker 路径设置 `process.exitCode`**

在输出 result JSON 后添加：

```ts
process.exitCode = exitCodeForLoopStatus(result.status)
```

位置：`src/harness/evaluation/cli.ts:246` JSON 输出之后。

- [ ] **步骤 3：测试退出码 helper**

在 `cli.test.ts` 中添加：

```ts
import { exitCodeForLoopStatus } from './cli.js'

test('maps loop status to process exit code', () => {
  expect(exitCodeForLoopStatus('success')).toBe(0)
  expect(exitCodeForLoopStatus('failed')).toBe(1)
  expect(exitCodeForLoopStatus('timeout')).toBe(1)
  expect(exitCodeForLoopStatus('infra_error')).toBe(1)
})
```

运行：

```powershell
bun test src/harness/evaluation/cli.test.ts
```

预期：通过。

---

### 任务 6：将 batch runner 改为固定并发流水线

**文件：**
- 修改：`src/harness/evaluation/batchRunner.ts`
- 测试：`src/harness/evaluation/batchRunner.test.ts`
- 修改：`src/harness/evaluation/cli.ts`
- 修改：`scripts/run-task-batches.ps1`
- 修改：`tests/test_task_batch_runner.py`

- [ ] **步骤 1：编写失败测试：最多只启动 3 个 worker，完成一个后立即补位**

在 `batchRunner.test.ts` 中新增一个 deferred worker 测试，验证流水线调度，而不是固定分批等待：

```ts
test('runs workers as a fixed-size pipeline', async () => {
  const started: string[] = []
  const resolvers = new Map<string, (exitCode: number) => void>()
  const spawnWorker: SpawnEvaluationWorker = request => {
    started.push(request.taskId)
    return new Promise(resolve => {
      resolvers.set(request.taskId, exitCode =>
        resolve({ taskId: request.taskId, exitCode }),
      )
    })
  }

  const running = runEvaluationBatch({
    taskIds: ['a', 'b', 'c', 'd', 'e'],
    tasksDir: 'tasks',
    runsDir: 'output/runs',
    maxRounds: 1,
    timeoutSeconds: 120,
    concurrency: 3,
    temperature: 1,
    thinking: 'disabled',
    verbose: false,
    spawnWorker,
  })

  await Promise.resolve()
  expect(started).toEqual(['a', 'b', 'c'])

  resolvers.get('b')?.(0)
  await Promise.resolve()
  expect(started).toEqual(['a', 'b', 'c', 'd'])

  resolvers.get('a')?.(0)
  await Promise.resolve()
  expect(started).toEqual(['a', 'b', 'c', 'd', 'e'])

  for (const taskId of ['c', 'd', 'e']) {
    resolvers.get(taskId)?.(0)
  }
  const result = await running
  expect(result.ok).toBe(true)
})
```

运行：

```powershell
bun test src/harness/evaluation/batchRunner.test.ts -t "fixed-size pipeline"
```

预期：当前实现失败，因为 `Promise.all(input.taskIds.map(...))` 会一次性启动所有 worker。

- [ ] **步骤 2：扩展类型，支持并发数和 watchdog grace**

在 `RunEvaluationBatchInput` 中新增：

```ts
concurrency?: number
workerTimeoutGraceSeconds?: number
```

在 `EvaluationWorkerRequest` 中新增：

```ts
timeoutMs?: number
```

默认值：

```ts
const concurrency = Math.max(1, input.concurrency ?? 3)
const timeoutMs = (input.timeoutSeconds + (input.workerTimeoutGraceSeconds ?? 60)) * 1000
```

- [ ] **步骤 3：实现固定并发池，失败继续**

将 `runEvaluationBatch()` 从一次性 `Promise.all(input.taskIds.map(...))` 改为 worker pool：

```ts
export async function runEvaluationBatch(
  input: RunEvaluationBatchInput,
): Promise<RunEvaluationBatchResult> {
  const spawnWorker = input.spawnWorker ?? defaultSpawnWorker
  const command = process.execPath
  const concurrency = Math.max(1, input.concurrency ?? 3)
  const timeoutMs = (input.timeoutSeconds + (input.workerTimeoutGraceSeconds ?? 60)) * 1000
  const workers: EvaluationWorkerResult[] = new Array(input.taskIds.length)
  let nextIndex = 0

  async function runNext(): Promise<void> {
    for (;;) {
      const index = nextIndex
      nextIndex++
      if (index >= input.taskIds.length) return

      const taskId = input.taskIds[index]
      try {
        workers[index] = await spawnWorker({
          taskId,
          command,
          args: workerArgs(input, taskId),
          timeoutMs,
        })
      } catch {
        workers[index] = { taskId, exitCode: 1 }
      }
    }
  }

  const lanes = Array.from(
    { length: Math.min(concurrency, input.taskIds.length) },
    () => runNext(),
  )
  await Promise.all(lanes)
  return {
    ok: workers.every(worker => worker.exitCode === 0),
    workers,
  }
}
```

要点：

- 不实现 `continueOnFailure=false` 的提前停止逻辑。
- 每条 lane 在当前 worker 结束后立即领取下一个任务。
- `workers` 按输入任务顺序返回，便于后续汇总和测试。

- [ ] **步骤 4：重写 `defaultSpawnWorker` 为带 kill 的 bounded wait**

将 worker 超时作为最后防线：

```ts
const defaultSpawnWorker: SpawnEvaluationWorker = request => {
  const child = Bun.spawn([request.command, ...request.args], {
    stdout: 'inherit',
    stderr: 'inherit',
    env: process.env,
  })
  return child.exited.then(exitCode => ({ taskId: request.taskId, exitCode }))
}
```

改为：

```ts
const defaultSpawnWorker: SpawnEvaluationWorker = request => {
  const child = Bun.spawn([request.command, ...request.args], {
    stdout: 'inherit',
    stderr: 'inherit',
    env: process.env,
  })
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<EvaluationWorkerResult>(resolve => {
    if (!request.timeoutMs) return
    timer = setTimeout(() => {
      child.kill('SIGTERM')
      setTimeout(() => child.kill('SIGKILL'), 5000).unref?.()
      resolve({ taskId: request.taskId, exitCode: 124 })
    }, request.timeoutMs)
    timer.unref?.()
  })
  const exited = child.exited.then(exitCode => ({ taskId: request.taskId, exitCode }))
  return Promise.race([exited, timeout]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}
```

注意：如果 `request.timeoutMs` 未设置，上面的 timeout Promise 不能永久悬挂在 `Promise.race` 中引用 timer；可单独分支处理：

```ts
  if (!request.timeoutMs) return child.exited.then(...)
```

- [ ] **步骤 5：新增失败继续测试**

新增测试：任务 `a` 返回 1，任务 `b`、`c` 仍然启动并完成；最终 `ok=false`。

```ts
test('continues launching queued workers after a worker fails', async () => {
  const started: string[] = []
  const spawnWorker: SpawnEvaluationWorker = async request => {
    started.push(request.taskId)
    return { taskId: request.taskId, exitCode: request.taskId === 'a' ? 1 : 0 }
  }

  const result = await runEvaluationBatch({
    taskIds: ['a', 'b', 'c'],
    tasksDir: 'tasks',
    runsDir: 'output/runs',
    maxRounds: 1,
    timeoutSeconds: 120,
    concurrency: 1,
    temperature: 1,
    thinking: 'disabled',
    verbose: false,
    spawnWorker,
  })

  expect(started).toEqual(['a', 'b', 'c'])
  expect(result.ok).toBe(false)
})
```

- [ ] **步骤 6：编写 worker watchdog 测试**

新增测试，模拟 spawnWorker 接收到 timeoutMs：

```ts
test('passes worker watchdog timeout to spawned workers', async () => {
  const timeouts: Array<number | undefined> = []
  const spawnWorker: SpawnEvaluationWorker = async request => {
    timeouts.push(request.timeoutMs)
    return { taskId: request.taskId, exitCode: 0 }
  }

  await runEvaluationBatch({
    taskIds: ['task_a'],
    tasksDir: 'tasks',
    runsDir: 'output/runs',
    maxRounds: 1,
    timeoutSeconds: 10,
    workerTimeoutGraceSeconds: 7,
    concurrency: 3,
    temperature: 1,
    thinking: 'disabled',
    verbose: false,
    spawnWorker,
  })

  expect(timeouts).toEqual([17000])
})
```

运行：

```powershell
bun test src/harness/evaluation/batchRunner.test.ts
```

预期：通过。

- [ ] **步骤 7：CLI parser 支持并发参数**

在 `cli.ts` 中新增参数：

```text
--concurrency <n>             Maximum source workers to run at once (default: 3)
--worker-timeout-grace-seconds <n>
```

将 `concurrency` 和 `workerTimeoutGraceSeconds` 传给 `runEvaluationBatch()`。保留 `batchSize` 作为 PowerShell 配置名，由 PowerShell 映射为 `--concurrency`。

- [ ] **步骤 8：PowerShell runner 改为提交完整任务集合**

修改 `scripts/run-task-batches.ps1`：

- 删除或停用 `Split-TaskBatches` 的固定分批执行路径。
- `batchSize` 继续从配置读取，默认 3，但语义改为最大并发数。
- `Build-BatchCommand` 接收完整 `$tasks`，生成一个包含所有 `--task` 的 CLI 命令。
- 增加参数透传：

```powershell
"--concurrency" = $batchSize
"--worker-timeout-grace-seconds" = (Get-ConfigValue $Config "workerTimeoutGraceSeconds" $null)
```

Dry-run JSON 建议改为：

```json
{
  "repoRoot": "...",
  "repoWslPath": "...",
  "maxConcurrentTasks": 3,
  "continueOnFailure": true,
  "tasks": ["task_a", "task_b", "task_c", "task_d"],
  "command": "cd ... && bun src/harness/evaluation/cli.ts --task task_a --task task_b ..."
}
```

如果为了兼容旧测试仍保留 `batches` 字段，也必须明确它只是 `plannedStartOrder`，不是固定等待边界。

- [ ] **步骤 9：PowerShell 配置默认失败继续**

修改 `scripts/run-task-batches.ps1`：

```powershell
$continueOnFailure = [bool](Get-ConfigValue $config "continueOnFailure" $true)
```

但当前需求不需要 `false` 行为，因此即使配置为 `false`，也不要在单个任务失败后停止整个任务集合。建议把该字段仅用于最终输出说明，或者在 README 标记为已废弃。

- [ ] **步骤 10：更新 Python runner 测试**

修改 `tests/test_task_batch_runner.py`：

- `test_dry_run_groups_tasks_three_at_a_time` 改为验证 `maxConcurrentTasks == 3`，命令包含所有任务。
- 新增测试：默认配置 dry-run 中 `continueOnFailure` 为 `true`。
- 新增测试：`mri_sense` / `mri_tv` 示例配置 dry-run 只生成一个总命令，而不是固定批次。

---

### 任务 7：端到端验证 timeout 后能够退出、补位并跑完整个任务集合

**文件：**
- 不一定修改文件；必要时新增临时 config，验证后删除。

- [ ] **步骤 1：运行单元测试**

运行：

```powershell
bun test src/harness/evaluation/sourceTaskLoop.test.ts
bun test src/harness/evaluation/batchRunner.test.ts
bun test src/harness/evaluation/cli.test.ts
python tests\test_task_batch_runner.py
```

预期：全部通过。

- [ ] **步骤 2：单 worker 短超时验证**

选择一个安全任务，运行很短 timeout：

```powershell
wsl.exe -e bash -lc "cd /mnt/d/yan1/agent/AutoSkill/my_claude && /home/admin/.bun/bin/bun src/harness/evaluation/cli.ts --task eht_black_hole_UQ --tasks-dir tasks --runs-dir output/runs --max-rounds 5 --timeout-seconds 5 --temperature 1 --thinking disabled --timestamp timeout_exit_probe"
```

预期：

- stderr 中出现 `Run finished with status timeout`。
- 命令在 timeout 后的 grace 时间内返回。
- PowerShell `$LASTEXITCODE` 为非 0。

- [ ] **步骤 3：流水线短超时验证**

创建临时配置 `config\timeout-exit-probe.json`：

```json
{
  "tasks": [
    "eht_black_hole_UQ",
    "eht_black_hole_feature_extraction_dynamic",
    "mri_tv",
    "mri_l1_wavelet"
  ],
  "batchSize": 2,
  "tasksDir": "tasks",
  "runsDir": "output/runs",
  "maxRounds": 5,
  "timeoutSeconds": 5,
  "workerTimeoutGraceSeconds": 10,
  "temperature": 1,
  "thinking": "disabled",
  "timestampPrefix": "timeout_exit_probe",
  "continueOnFailure": true,
  "loadLocalConfig": true,
  "bunPath": "/home/admin/.bun/bin/bun"
}
```

运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass `
  -File scripts\run-task-batches.ps1 `
  -ConfigPath config\timeout-exit-probe.json
```

预期：

- 开始时最多同时运行 2 个 worker。
- 任意 worker timeout / failed / success 后，任务队列中还有剩余任务时立即启动下一个 worker。
- 不等待“当前 2 个任务都结束”才启动下一组。
- 所有 4 个任务都被尝试后脚本退出。
- 若有 timeout 或 failed，整体退出码非 0，但中间失败不阻止后续任务。

- [ ] **步骤 4：清理临时验证配置**

如果创建了 `config\timeout-exit-probe.json`，验证后删除该临时文件，避免污染默认任务集合。

---

## 风险与注意事项

- `Promise.race()` 超时不是取消；必须同时关闭 generator 和触发 `QueryEngine.interrupt()`。
- `events.return?.()` 可能也被底层 generator 卡住；因此 batch 层 watchdog 仍是必要的最后防线。
- `child.kill('SIGTERM')` 后应有 `SIGKILL` 二级兜底，避免 WSL/Bun 子进程忽略软终止。
- `process.exitCode` 改为 timeout 非 0 后，batch runner 仍必须继续调度队列中的后续任务；退出码只用于最终汇总，不用于提前停止。
- `continueOnFailure` 默认值为 `true`；当前需求不实现 `false` 的失败即停止行为。
- 不要把“记录 `run_finished`”当成进程退出证据；最终验证必须看 CLI 命令返回和 `$LASTEXITCODE`。
