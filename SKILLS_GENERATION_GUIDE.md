# Skills 自动生成机制说明

## 概述

skills-learning 模块实现了一个**完整的自动化 skills 学习循环**，能够从任务执行的 trajectory 中自动提取、生成、验证和激活 skills。

## 核心设计理念

### Skills 不是任务配方（Task Recipe）
- ❌ **错误**：记录特定任务的具体步骤、参数、代码片段
- ✅ **正确**：提取可迁移的抽象流程指导、决策规则、验证策略

### Skills 是应用契约（Application Contract）
每个 skill 应该包含：
1. **何时调用**（When to use）：问题信号、触发条件
2. **如何验证**（Validation checks）：廉价探针、快速检查
3. **停止条件**（Stop conditions）：何时放弃或切换策略
4. **预算规则**（Budget rules）：预期运行时间、资源限制
5. **反模式**（Anti-patterns）：应避免的常见错误

## 自动生成流程

### 完整的学习循环（Learning Cycle）

```
1. Index Evidence (索引证据)
   ↓
2. Learn Candidates (生成候选 skills)
   ↓
3. Critic Review (评审)
   ↓
4. Validate on Training Set (训练集验证)
   ↓
5. Activate Validated Skills (激活)
   ↓
6. Validate on Validation Set (验证集测试)
   ↓
7. Refine Failed Skills (失败改进)
```

### 各阶段详细说明

#### 1️⃣ **Index Evidence** (证据索引)
**作用**：扫描历史 runs，构建证据包

**输入**：
- 历史任务运行目录（runs-dir）
- Train/Valid 任务划分配置

**输出**：
```json
{
  "taskId": "da-17-3",
  "kind": "success-vs-failure",  // 或 "failure-vs-std-code", "single-trajectory"
  "runs": [
    { "runId": "...", "status": "success", "reward": 1.0 },
    { "runId": "...", "status": "failed", "reward": 0.0 }
  ]
}
```

**运行命令**：
```bash
bun src/skills-learning/cli.ts index \
  --config config/skill-learning.json \
  --cycle-id cycle-001
```

---

#### 2️⃣ **Learn Candidates** (生成候选 skills)
**作用**：调用 LLM agent 分析证据，生成 skill 候选

**关键 Prompts**：
- `trajectory-analyst.md`: 分析单个 trajectory
- `success-failure-comparator.md`: 对比成功/失败 runs
- `std-code-comparator.md`: 对比 agent 实现与标准代码

**Agent 分析重点**：
- 成功 run 中的决策模式
- 失败 run 中的重复错误
- 工具使用差异
- 验证失败原因
- 资源浪费模式（如无效的长时间运行）

**输出格式** (SkillCandidate JSON)：
```json
{
  "schema_version": 2,
  "id": "biomnibench-pseudobulk-strategy",
  "namespace": "biomnibench",
  "type": "general",
  "title": "Pseudobulk Aggregation for Single-Cell DE Analysis",
  "trigger": {
    "problem_signals": [
      "Task involves differential expression analysis",
      "Data contains single-cell measurements with donor/patient metadata",
      "File size > 1GB indicating large single-cell dataset"
    ]
  },
  "guidance": {
    "diagnostic_steps": [
      "Check if data has donor/patient grouping variables",
      "Verify cell count per donor (should be > 10 for aggregation)",
      "Confirm outcome variable (disease status, treatment, etc.)"
    ],
    "tool_decision_rules": [
      "Use backed='r' mode for initial exploration to avoid loading full data",
      "Aggregate counts by donor before statistical testing",
      "Use appropriate test for count data (Wilcoxon, DESeq2-like)"
    ],
    "validation_checks": [
      "Probe: adata.obs['donor'].value_counts() shows balanced design",
      "Expected runtime: 5-10 min for pseudobulk, 3-5 min for DE test",
      "Stop if memory errors persist after 3 attempts"
    ],
    "anti_patterns": [
      "Treating single cells as independent samples (pseudoreplication)",
      "Loading entire h5ad repeatedly without caching",
      "Running DE test before checking data structure"
    ]
  },
  "evidence_runs": ["da-17-3_20260610_011318"],
  "validation": {
    "status": "candidate",
    "success_delta": 0,
    "regressions": 0
  }
}
```

**运行命令**：
```bash
bun src/skills-learning/cli.ts learn \
  --config config/skill-learning.json \
  --cycle-id cycle-001
```

---

#### 3️⃣ **Critic Review** (评审)
**作用**：自动检查 skill 候选是否违反安全规则

**Prompt**: `skill-critic.md`

**拒绝条件**：
- ❌ 包含代码片段、私有路径、ground truth 值
- ❌ 绑定特定 task ID，无法迁移
- ❌ 包含固定的 epoch/iteration 数字（应读取当前任务参数）
- ❌ 缺少必需字段（problem_signals, diagnostic_steps, validation_checks）
- ❌ 与现有 skill 重复

**运行命令**：
```bash
bun src/skills-learning/cli.ts critic \
  --config config/skill-learning.json \
  --cycle-id cycle-001
```

---

#### 4️⃣ **Validate on Training Set** (训练集验证)
**作用**：在训练集任务上测试 skill 是否有效

**验证策略**：
- 每个候选 skill 单独测试（isolation）
- 对比 baseline（无 skills）vs with-skill 的表现
- 计算 `success_delta` = (with_skill_success_rate - baseline_success_rate)

**输出**：
```json
{
  "skill_id": "biomnibench-pseudobulk-strategy",
  "baseline": { "pass": 2, "fail": 3, "total": 5 },
  "with_skill": { "pass": 4, "fail": 1, "total": 5 },
  "success_delta": 0.4,  // (4/5) - (2/5) = 0.4
  "verdict": "beneficial"
}
```

**运行命令**：
```bash
bun src/skills-learning/cli.ts validate-train \
  --config config/skill-learning.json \
  --cycle-id cycle-001
```

---

#### 5️⃣ **Activate Validated Skills** (激活)
**作用**：将 `success_delta > 0` 的 skills 激活

激活后的 skill 会被写入 `skills/<skill-id>/SKILL.md`，供后续任务使用。

**运行命令**：
```bash
bun src/skills-learning/cli.ts activate \
  --config config/skill-learning.json \
  --cycle-id cycle-001
```

---

#### 6️⃣ **Validate on Validation Set** (验证集测试)
**作用**：测试 skills 在未见过的任务上的泛化能力

防止过拟合训练集。

**运行命令**：
```bash
bun src/skills-learning/cli.ts validate-valid \
  --config config/skill-learning.json \
  --cycle-id cycle-001
```

---

#### 7️⃣ **Refine Failed Skills** (失败改进)
**作用**：对训练集验证失败的 skills 进行分析和改进

重新调用 agent 分析失败原因，生成改进版本。

**运行命令**：
```bash
bun src/skills-learning/cli.ts refine-failed \
  --config config/skill-learning.json \
  --cycle-id cycle-001
```

---

## 一键运行完整循环

```bash
bun src/skills-learning/cli.ts cycle \
  --config config/skill-learning.json \
  --cycle-id cycle-001
```

这会依次执行：index → learn → critic → validate-train → activate → validate-valid

---

## BioMniBench 的配置示例

### config/skill-learning.json

```json
{
  "paths": {
    "runsRoot": "/data/yjh/biomnibench-runs-v2",
    "workDir": "output/skill-learning",
    "skillsDir": "skills"
  },
  "split": {
    "train": [
      "da-1-1", "da-1-2", "da-3-1", "da-5-1", "da-8-1",
      "da-10-1", "da-12-1", "da-15-1", "da-17-1", "da-20-1"
    ],
    "valid": [
      "da-1-3", "da-3-2", "da-5-2", "da-8-2", "da-10-2",
      "da-12-2", "da-15-2", "da-17-3", "da-20-2"
    ]
  },
  "limits": {
    "maxCandidatesPerCycle": 10,
    "maxActiveSkillsAppliedPerRun": 3,
    "maxEvidenceTasksPerPackage": 5
  },
  "validation": {
    "taskTimeoutSeconds": 2500,
    "maxRounds": 2,
    "minSuccessDeltaForActivation": 0.1
  }
}
```

---

## 手动创建 Skills（快速原型）

如果你想快速测试一个 skill 想法，可以手动创建：

### 1. 创建目录和文件

```bash
mkdir -p skills/my-skill-name
```

### 2. 编写 SKILL.md

参考自动生成的格式，至少包含：

```markdown
# Skill Title

## When to use
- Problem signal 1
- Problem signal 2

## Abstract process
1. Diagnostic step 1
2. Decision rule 1
3. Validation check 1

## Anti-patterns to avoid
- Anti-pattern 1
- Anti-pattern 2

## Validation probe
Quick command to verify approach

## Stop condition
When to give up or switch strategy

## Expected runtime
Time estimate for different phases
```

### 3. 测试

```bash
bun run src/harness/evaluation/cli.ts \
  --task da-17-3 \
  --tasks-dir /data/yjh/biomnibench-organized \
  --runs-dir /data/yjh/biomnibench-runs-v2 \
  --max-rounds 2 \
  --timeout-seconds 2500 \
  --enable-skills \
  --skill-name my-skill-name
```

---

## 从现有 runs 生成第一个 skill

### 快速上手步骤

```bash
cd /data/yjh/my_claude_biomnibench

# 1. 创建配置
cat > config/skill-learning.json << 'EOF'
{
  "paths": {
    "runsRoot": "/data/yjh/biomnibench-runs-v2",
    "workDir": "output/skill-learning",
    "skillsDir": "skills"
  },
  "split": {
    "train": ["da-17-3", "da-26-2", "da-11-1"],
    "valid": ["da-1-3", "da-5-1"]
  },
  "limits": {
    "maxCandidatesPerCycle": 5,
    "maxActiveSkillsAppliedPerRun": 2
  }
}
EOF

# 2. 设置环境变量
export ANTHROPIC_API_KEY="your-api-key"
export ANTHROPIC_BASE_URL="https://api.gpugeek.com"
export ANTHROPIC_MODEL="Vendor2/Claude-4.7-opus"

# 3. 运行完整学习循环
bun src/skills-learning/cli.ts cycle \
  --config config/skill-learning.json \
  --cycle-id biomnibench-001
```

---

## Skills vs 手动提示词的区别

| 维度 | 手动提示词 | 自动 Skills |
|------|-----------|-------------|
| **来源** | 人工编写 | 从 trajectory 自动提取 |
| **迭代** | 手动修改 | 自动验证和改进 |
| **泛化** | 依赖人工判断 | 验证集自动测试 |
| **规模** | 难以维护大量提示词 | 自动管理 skill pool |
| **证据** | 基于经验 | 基于实际运行数据 |

---

## 总结

✅ **已集成**：完整的 skills-learning 模块已复制到项目中

🎯 **下一步**：
1. **快速测试**：手动创建 1-2 个 skills 验证集成正常工作
2. **自动生成**：配置 skill-learning.json，运行 cycle 命令从历史 runs 学习
3. **效果评估**：对比启用/禁用 skills 的评分差异

📚 **参考**：
- 源项目设计文档：`docs/skills-learning-design.md`
- 源项目操作手册：`docs/skills-learning-operations.md`
