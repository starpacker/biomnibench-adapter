# BioMniBench 失败任务 Re-run 报告

**启动时间**：2026-06-10 19:35:38  
**状态**：✅ 运行中（PID 208336）  
**预计完成**：明早 ~13:00-15:00（约 18 小时）

---

## 📊 Re-run 配置

### 任务清单
- **失败任务数**：29 个（仅有失败 runs 的 task）
- **每任务重跑**：3 次（串行，避免时间戳冲突）
- **总 runs**：87 个

### 执行策略
- **并行任务数**：4（不同 task 并行）
- **每任务内部**：串行执行 3 次 attempt，确保唯一时间戳
- **Max rounds**：3（judge 反馈迭代）
- **Timeout**：3000s/run（50 分钟，增加 20%）

### 29 个失败任务
```
da-1-3  da-1-4  da-10-1  da-10-3  da-11-1  da-12-2  da-12-4
da-13-1  da-13-3  da-15-2  da-17-3  da-18-7  da-19-4  da-20-3
da-20-4  da-26-2  da-3-4  da-3-5  da-4-1  da-4-6  da-4-7
da-5-1  da-5-3  da-6-2  da-6-5  da-8-2  da-8-3  da-9-1  da-9-7
```

---

## 🎯 Re-run 目标

### Skills-learning 证据需求
1. **success-vs-failure**：同一 task 既有成功又有失败 runs
   - 当前仅 1 个（da-8-1）
   - 目标：重跑后产生 10-15 个

2. **single-trajectory**：从失败 runs 提取反模式
   - 即使全部失败，也能学习 anti-patterns

### 预期成果
- **新增成功 runs**：预计 20-30 个（基于增加的 rounds/timeout）
- **可生成 skills 的 task**：15-20 个
- **Skills 类型**：
  - 内存优化策略（da-1-3, da-17-3 等大数据任务）
  - Rubric 遵循指导（da-26-2）
  - 统计测试决策规则
  - 数据探索流程

---

## 🔍 监控

### 实时监控
```bash
# 主日志
tail -f /data/yjh/biomnibench-rerun-logs/MAIN_20260610_193538.log

# 监控脚本（每次刷新显示进度）
/data/yjh/my_claude_biomnibench/scripts/monitor_rerun.sh

# 检查最新完成
find /data/yjh/biomnibench-runs-v2 -name "run_summary.json" -mmin -10 | xargs -I {} python3 -c "
import json, sys
d = json.load(open('{}'))
print('{}: status={} reward={:.2f} rounds={}'.format(
    '{}',
    d.get('status'),
    d.get('reward', 0),
    d.get('rounds')
))
"
```

### 关键指标
- ✅ **主进程存活**：`ps -ef | grep rerun_failed_tasks`
- ✅ **Bun 子进程数**：应保持 4 个左右
- 📂 **Run 目录数量**：应递增到 53 + 87 = 140

---

## 📝 已解决的技术问题

### 问题 1：SIGHUP 杀死后台进程
- **现象**：`nohup ... &` 后台进程收到 Hangup 信号（exit=129）
- **原因**：父 shell 退出时传递 SIGHUP
- **解决**：`setsid nohup ... &` + `disown` 完全分离会话

### 问题 2：时间戳冲突
- **现象**：同一 task 的多个 attempt 并发启动，run 目录时间戳相同导致冲突
- **错误**：`cannot copy ... to a subdirectory of self`
- **解决**：改为**串行 attempts**（同一 task 的 3 次 attempt 顺序执行），不同 task 仍并行

---

## 📂 输出结构

### Run 目录
```
/data/yjh/biomnibench-runs-v2/
├── da-1-3_20260610_193539/      # Attempt 1
│   ├── logs/
│   │   ├── run_summary.json     # 关键：status, reward, rounds
│   │   └── trajectory.clean.jsonl
│   ├── outputs/
│   ├── public/
│   └── workspace/
├── da-1-3_20260610_193542/      # Attempt 2 (sleep 3s 后)
└── da-1-3_20260610_193545/      # Attempt 3
```

### 日志目录
```
/data/yjh/biomnibench-rerun-logs/
├── MAIN_20260610_193538.log           # 主日志
├── tasks_to_run.txt                   # 29 个 task 列表
├── da-1-3_attempt1_20260610_193538.log  # 每个 attempt 的 CLI 输出
├── da-1-3_attempt2_...log
└── ...
```

---

## ✅ Re-run 完成后的下一步

### 1. 统计新的成功/失败分布
```bash
cd /data/yjh/biomnibench-runs-v2
python3 << 'PYEOF'
import json, glob
from collections import defaultdict

records = defaultdict(list)
for f in glob.glob('*/logs/run_summary.json'):
    d = json.load(open(f))
    task = f.split('/')[0].split('_')[0]
    status = d.get('status', '?')
    reward = d.get('reward', 0)
    records[task].append((status, reward))

sv_tasks = [t for t, runs in records.items() 
            if any(s=='success' or r>=1 for s,r in runs) 
            and any(s!='success' and r<1 for s,r in runs)]

print(f"Tasks with success-vs-failure evidence: {len(sv_tasks)}")
for t in sorted(sv_tasks):
    runs = records[t]
    succ = sum(1 for s,r in runs if s=='success' or r>=1)
    fail = len(runs) - succ
    print(f"  {t}: {succ} success, {fail} failure")
PYEOF
```

### 2. 配置并运行 skills-learning cycle
```bash
cd /data/yjh/my_claude_biomnibench

# 更新配置（使用有 success-vs-failure 证据的 task）
cat > config/skill-learning.json << 'EOF'
{
  "paths": {
    "runsRoot": "/data/yjh/biomnibench-runs-v2",
    "workDir": "output/skill-learning",
    "skillsDir": "skills"
  },
  "split": {
    "train": ["da-1-3", "da-1-4", "da-17-3", "da-26-2", "da-5-1", 
              "da-11-1", "da-3-4", "da-10-1", "da-8-1"],
    "valid": ["da-12-2", "da-15-2", "da-19-4", "da-3-5"]
  },
  "limits": {
    "maxCandidatesPerCycle": 10,
    "maxActiveSkillsAppliedPerRun": 3
  },
  "validation": {
    "minSuccessDeltaForActivation": 0.15
  }
}
EOF

# 运行完整学习循环
bun src/skills-learning/cli.ts cycle \
  --config config/skill-learning.json \
  --cycle-id biomnibench-001
```

### 3. 分析生成的 skills
```bash
# 查看生成的 skills
ls -lh skills/*/SKILL.md

# 查看 skill pool
cat output/skill-learning/pool/pool.json | python3 -m json.tool
```

### 4. 启用 skills 重跑低分任务
```bash
# Baseline（无 skills）已有旧数据
# 现在用 skills 重跑低分任务对比

bun run src/harness/evaluation/cli.ts \
  --task da-26-2 \
  --tasks-dir /data/yjh/biomnibench-organized \
  --runs-dir /data/yjh/biomnibench-runs-v2 \
  --max-rounds 3 \
  --timeout-seconds 3000 \
  --enable-skills
```

---

## 📊 当前状态摘要

```
原始状态（re-run 前）：
  Total runs:   53
  Success:      21 (39.6%)
  Failure:      32 (60.4%)
  Success-vs-failure evidence: 1 task

Re-run 目标：
  新增 runs:    87
  预期 success: 20-30
  预期 success-vs-failure: 15-20 tasks

最终预期：
  Total runs:   140
  Success:      40-50 (30-35%)
  Skills:       生成 5-10 个可用 skills
```

---

## 🛠️ 相关脚本

| 脚本 | 用途 |
|------|------|
| `scripts/rerun_failed_tasks.sh` | 主 re-run 脚本（87 runs） |
| `scripts/launch_rerun_detached.sh` | Detached 启动器（setsid） |
| `scripts/monitor_rerun.sh` | 实时监控脚本 |
| `scripts/smoke_test_rerun.sh` | 小规模测试脚本 |

---

## ⏱️ 时间线

- **19:25** - Smoke test（2 tasks × 1）→ 被 SIGHUP 杀死
- **19:31** - 第 1 次完整启动 → 时间戳冲突，立即失败
- **19:35** - ✅ 第 2 次启动（修复版）→ **运行中**
- **~13:00-15:00（次日）** - 预计完成

---

**注意**：Re-run 完成后会自动打印汇总统计。完成后请向我汇报，我们将一起分析结果并进行 skill extraction！
