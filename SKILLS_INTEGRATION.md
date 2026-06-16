# Skills Integration for my_claude_biomnibench

## 概述

已成功将 `feature/native-skill-learning` 分支的 skills 机制集成到 my_claude_biomnibench 项目中。

## 集成内容

### 1. 新增模块
- **`src/skills-learning/`**: 完整的 skills 学习和管理模块
  - `skillPool.ts`: Skills 池管理
  - `skillRenderer.ts`: Skills 渲染
  - `skillCritic.ts`: Skills 评估
  - `skillLearningCycle.ts`: Skills 学习循环
  - `validationRunner.ts`: Skills 验证
  - 其他支持文件

### 2. 修改的核心文件

#### `src/harness/evaluation/types.ts`
- 添加 `EvaluationSkillOptions` 类型定义
- 在 `SourceAgentStartInput` 中添加 `skillOptions?` 字段
- 在 `RunSourceTaskLoopInput` 中添加 `skillOptions?` 字段

#### `src/harness/evaluation/cli.ts`
- 添加 CLI 参数：
  - `--enable-skills`: 启用 native SkillTool
  - `--skills-dir <path>`: 指定 skills 目录（默认 `skills/`）
  - `--skill-name <name>`: 限制特定 skill（可重复）
  - `--max-active-skills <n>`: 限制激活的 skills 数量
- 添加 `skillOptions` 参数解析逻辑
- 将 `skillOptions` 传递给 `runSourceTaskLoop`

#### `src/harness/evaluation/sourceTaskLoop.ts`
- 在创建 agent session 时传递 `skillOptions` 参数

#### `src/harness/evaluation/sourceContextBuilder.ts`
- 添加 `activeSkillsPromptBlock()` 函数
- 该函数生成 `<active_skills>` prompt 块，指导 Agent 使用 skills

### 3. 新增目录结构

```
my_claude_biomnibench/
├── skills/                          # Skills 存储目录
│   └── biomnibench-data-analysis/   # 示例 skill
│       └── SKILL.md                 # Skill 定义
├── config/
│   └── skill-learning.json          # Skills 学习配置
└── src/
    └── skills-learning/             # Skills 学习模块
```

## 使用方法

### 基本用法

```bash
# 启用 skills 运行任务
/home/yjh/.bun/bin/bun run src/harness/evaluation/cli.ts \
  --task da-17-3 \
  --tasks-dir /data/yjh/biomnibench-organized \
  --runs-dir /data/yjh/biomnibench-runs-v2 \
  --max-rounds 2 \
  --timeout-seconds 2500 \
  --enable-skills \
  --skills-dir skills \
  --skill-name biomnibench-data-analysis
```

### 参数说明

- `--enable-skills`: 必须，启用 SkillTool
- `--skills-dir`: 可选，指定 skills 目录（默认 `skills/`）
- `--skill-name`: 可选，限制使用特定 skill（可多次使用）
- `--max-active-skills`: 可选，限制同时激活的 skills 数量

## 示例 Skill

已创建 `skills/biomnibench-data-analysis/SKILL.md`，包含：
- **When to use**: 适用场景（大数据、差异表达分析等）
- **Abstract process**: 抽象流程步骤
- **Anti-patterns**: 应避免的错误模式
- **Validation probe**: 快速验证命令
- **Stop condition**: 停止条件
- **Expected runtime**: 预期运行时间

## Skills 工作机制

1. **CLI 启动时**：解析 `--enable-skills` 等参数，创建 `skillOptions` 对象
2. **Task Loop 初始化**：将 `skillOptions` 传递给 agent session
3. **Prompt 构建**：`activeSkillsPromptBlock()` 生成 skills 指导文本
4. **Agent 执行**：
   - Agent 可调用 `Skill` tool 查询相关 skills
   - 在 round plan 中包含 "Applied skills checklist"
   - 完成前写 `workspace/skill_application.json` 记录使用情况

## 下一步：测评 Skills 效果

### 测评计划

1. **对比实验**：
   - 重跑之前失败的任务（如 da-17-3, da-26-2）
   - 对比启用/禁用 skills 的性能差异

2. **评估指标**：
   - 任务完成率提升
   - 平均分数提升
   - 超时率下降
   - Memory 错误减少

3. **运行命令**：
```bash
# 不带 skills（baseline）
bun run src/harness/evaluation/cli.ts --task da-17-3 ...

# 带 skills（实验组）
bun run src/harness/evaluation/cli.ts --task da-17-3 ... --enable-skills --skill-name biomnibench-data-analysis
```

## 待完善

- [ ] 完善 `biomnibench-data-analysis` skill 的具体指导
- [ ] 创建更多针对不同任务类型的 skills
- [ ] 实现 skills 学习循环（从成功/失败的 runs 中学习）
- [ ] 添加 skills 使用统计和效果分析

## 参考

- 源分支：[Godlikegu/my_claude feature/native-skill-learning](https://github.com/Godlikegu/my_claude/tree/feature/native-skill-learning)
- Skills 设计文档：`docs/skills-learning-design.md`（源项目）
- Skills 操作文档：`docs/skills-learning-operations.md`（源项目）
