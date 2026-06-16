# BioMniBench 批量测评 Timeout 根因分析

## 问题总览

批量测评 50 个任务，出现两类异常退出：
- **13 个任务 `rc=1` (FAIL)**：有评分，但 CLI 报告 `Score: 0/100` + `status=failed`
- **7 个任务 `rc=124` (TIMEOUT)**：达到 4500s hard timeout 被 kill，但 round 都跑完了

## 🔥 根因 1：`obj.score` vs `obj.total_score` 字段不匹配

### 问题定位

**文件**：`src/harness/evaluation/judgeRunner.ts` 第 114 行

```typescript
function mapBioMniBenchJudgeResult(...) {
  const obj = ...
  const rawScore = typeof obj.score === 'number' ? obj.score : Number(obj.score ?? 0)
  //                              ^^^^^ BUG: 读错字段
  const score = Number.isFinite(rawScore) ? Math.max(0, Math.min(100, rawScore)) : 0
  const status = score >= passThreshold ? 'pass' : 'fail'
  const feedback = `Score: ${score}/100`  // 构造虚假的 0/100 feedback
  ...
}
```

### 症状

`llm_judge_qwen.py` 输出的 JSON 格式：
```json
{
  "total_score": 91,
  "max_score": 100,
  "criteria": {...}
}
```

**没有 `score` 字段！** 代码读 `obj.score`（undefined）→ `Number(undefined ?? 0)` = `NaN` → clamp 到 `0` → `status='fail'`。

### 实际影响

| 任务 | round 1 真实分 | CLI 误报 | round 2 真实分 | 最终状态 |
|---|---|---|---|---|
| da-3-5 | 100 | 0/100 fail | 100 | rc=1 (浪费 1 轮) |
| da-5-1 | 100 | 0/100 fail | 91 | rc=1 (降分！) |
| da-10-3 | 100 | 0/100 fail | (未跑) | rc=1 |
| da-8-2 | 90 | 0/100 fail | (未跑) | rc=1 |
| ... | | | | 13 个任务全部 rc=1 |

**连锁后果**：
1. Agent 在 round 2 看到虚假 `Score: 0/100` feedback，误以为失败继续重试
2. Round 2 可能降分（因为 agent 改错方向）或无意义重复
3. CLI 最终以 `last_judge_status=fail` 退出 rc=1

### 修复方案

```typescript
const rawScore = typeof obj.total_score === 'number' ? obj.total_score :
                 typeof obj.score === 'number' ? obj.score :
                 Number(obj.total_score ?? obj.score ?? 0)
```

---

## 🔥 根因 2：CLI 打完 `run_finished` 后不退出，hang 到 4500s 被 kill

### 问题定位

**症状**：7 个任务的 log 都在 `run_finished` 后停止写入，但 bun 进程持续存活 ~70-75 分钟，最终被 `timeout` 命令的 4500s hard limit kill (rc=124)。

**典型 timeline（da-4-6）**：
```
17:37:17.966  agent_step_finished round=2 finalize_submission
17:37:17.968  judge_started round=2
17:38:17.139  judge_finished round=2 fail: Score: 0/100
17:38:17.145  run_finished Run finished with status failed
              ↓
              (log 停止写入，但 bun 进程还活着)
              ↓
~73 分钟后     timeout 命令发 SIGTERM (rc=124)
```

### 根因推测

**CLI 依赖 event loop 自然结束**（只设 `process.exitCode`，没显式 `process.exit()`），但有资源未关闭导致 hang：

可能的泄漏点：
1. **QueryEngine session 未 close**：与 Anthropic API 的 long-poll 连接可能未正确关闭
2. **文件 handle 泄漏**：trajectory.jsonl / run_events.jsonl 写入后未 flush/close
3. **未 await 的异步任务**：写 log、关闭 session 的 promise 飘在 event loop 里
4. **定时器残留**：某处用了 `setInterval` / `setTimeout` 但未 clear

**关键证据**：所有 7 个 TIMEOUT 任务都在 `run_finished` 后立刻停止 log 输出，说明主逻辑已结束，只是清理代码 hang 住了。

### 为什么只有 7 个 TIMEOUT，其他 rc=1 没 hang？

**猜测**：CLI 在 `status=failed` 时的清理路径与 `status=pass` 不同，可能某个错误处理分支有未关闭的资源。

或者：某些任务的 agent session 状态特殊（如 cache 残留、tool result 超大），导致关闭 session 时 hang。

### 修复方案

#### 短期（防御性）
1. ✅ **已实施**：用 `timeout --kill-after=30 --signal=TERM 4500` 包裹整个 bun 进程（当前批处理已生效）
2. 在 CLI main 函数最后加 `process.exit(process.exitCode ?? 0)`，强制退出不等 event loop

#### 长期（治本）
1. 审查 QueryEngine session 关闭逻辑，确保 `session.close()` 被 await
2. 审查所有 `fs.writeFile` / `fs.createWriteStream`，确保 `await close()` 或 `stream.end()`
3. 搜索 `setInterval` / `setTimeout`，确保在退出前 `clearInterval` / `clearTimeout`
4. 加 `process.on('beforeExit', ...)` hook 打印残留 handle 用于 debug

---

## 综合影响统计

| 问题 | 任务数 | 症状 | 根因 |
|---|---|---|---|
| rc=1 误报 0 分 | 13 | 有评分但 CLI 报 fail | `obj.score` 读错字段 |
| rc=124 hang 死 | 7 | 跑完但进程不退出被 kill | event loop 未清理资源 |
| **总计** | **20/50 (40%)** | **非正常退出** | |

**好消息**：所有 20 个任务都被正确评分了（JSON 文件在 `.judge_private/` 里），只是 CLI 退出码不对。

---

## 修复优先级

### P0（立刻修）
1. **`judgeRunner.ts` 第 114 行改读 `total_score`**
   - 影响：修复后所有 13 个 rc=1 任务变 rc=0，agent 不会被虚假 0 分误导重试
   - 副作用：无

### P1（建议修）
2. **CLI main 函数最后加 `process.exit()`**
   - 影响：修复 7 个 rc=124 hang 死问题，任务跑完立刻退出
   - 副作用：如果有异步 log 写入未完成可能丢数据（但当前已经 hang 75 分钟，显然等不到）

### P2（治本，可延后）
3. 审查并修复资源泄漏点（session、file handle、timer）

---

## 建议下一步操作

1. **立刻修 `judgeRunner.ts`**（5 分钟改完）
2. 重新编译 bun CLI：`cd /data/yjh/my_claude_biomnibench && /home/yjh/.bun/bin/bun build`（如果需要）
3. 杀掉当前批处理（已经跑了 13h，再跑 13h 也是重复同样的 bug）
4. 用修复后的 CLI 重跑全部 50 任务（或只跑失败的 20 个）

---

## 附录：受影响任务清单

### rc=1 (FAIL, 13 个)
da-3-5, da-4-1, da-5-1, da-6-2, da-6-5, da-8-1, da-8-2, da-8-3, da-9-1, da-10-3, da-11-1, da-12-2, da-13-1

### rc=124 (TIMEOUT, 7 个)
da-4-6, da-4-7, da-5-3, da-9-7, da-10-1, da-12-4, da-13-3
