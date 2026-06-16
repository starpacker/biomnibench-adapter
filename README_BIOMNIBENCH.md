# my_claude_biomnibench

这是 `my_claude` 的副本，专门用于测评 `/data/yjh/biomnibench-organized` 中的 BioMniBench 任务。

## 与原 my_claude 的差异

- **来源**：`/home/yjh/my_claude/` 的完整副本
- **排除目录**：`tasks/`, `output/`, `logs/`, `__pycache__/`, `.git/`
- **目标**：让 bun CLI 能正确执行 biomnibench-organized 任务

## 任务结构对比

### my_claude 原期望的任务结构 (imaging 风格)
```
tasks/<task_id>/
├── README.md
├── envs/
│   ├── env_manifest.json          # ✨ 关键
│   └── runtime/.venv/bin/python   # ✨ 关键
├── output_schema.json              # ✨ 关键
├── visible_data/cases.json         # ✨ 关键
├── task_manifest.json (完整)
└── evaluation/
    ├── judge.py
    ├── metrics.json
    └── visualization.py
```

### biomnibench-organized 实际结构 (Docker 风格)
```
da-X-Y/
├── README.md                       # ✅ 任务描述
├── data/                           # ✅ 真实数据
├── envs/Dockerfile                 # ❌ 不是 env_manifest
├── visible_data/                   # ✅ 数据列表（无 cases.json）
├── evaluation/
│   ├── llm_judge.py                # 自带 Anthropic judge
│   ├── rubric.txt                  # 评分标准
│   └── test.sh                     # Docker 内运行
├── task.toml                       # 元数据 (TOML 格式)
└── task_manifest.json              # 极简 (只有 task_id)
```

## 修复方案

修改 `src/harness/evaluation/` 下的关键文件以支持 biomnibench 任务结构：

1. **`sourceRuntimeResolver.ts`**: 当 `env_manifest.json` 不存在时，回退到共享 venv
2. **`sourceContextBuilder.ts`**: 让 `output_schema.json` 和 `cases.json` 可选
3. **`sourceTaskLoop.ts`** / **`taskEnvironment.ts`**: 支持 `task.toml` 元数据
4. **新增 `biomnibench/` 适配器目录**: 自动为每个任务生成所需文件

## 共享 Python 环境

所有 da- 任务共享一个 venv：`/data/yjh/my_claude_biomnibench/shared_venv/`

包含：pandas, numpy, scipy, scanpy, anndata, openpyxl, statsmodels 等数据科学包。

## 创建时间

2026-06-08
