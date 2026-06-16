# BioDSBench Combined Tasks - 快速开始指南

## 📋 概述

已成功创建 **13个combined任务**，合并了118个子任务：

| 任务ID | 子任务数量 | 说明 |
|--------|-----------|------|
| 25303977_combined | 8 | 已测试验证 ✅ |
| 27959731_combined | 10 | |
| 28472509_combined | 10 | |
| 28481359_combined | 9 | |
| 28985567_combined | 9 | |
| 29713087_combined | 7 | |
| 30742119_combined | 8 | |
| 30867592_combined | 10 | |
| 32437664_combined | 13 | |
| 32864625_combined | 6 | |
| 33765338_combined | 12 | |
| 34819518_combined | 6 | |
| 37699004_combined | 10 | |

**总计**: 118个子任务

## 🚀 快速开始

### 方法1: 运行单个任务

```bash
cd /home/yjh/my_claude
./run_biodsbench.sh 25303977_combined
```

### 方法2: 批量运行所有任务

```bash
cd /home/yjh/my_claude
./run_all_combined_tasks.sh
```

从特定任务开始（例如从第5个任务开始）：
```bash
./run_all_combined_tasks.sh 4  # 索引从0开始
```

### 方法3: 使用Bun直接运行

```bash
cd /home/yjh/my_claude
bun run src/harness/evaluation/cli.ts \
  --task "25303977_combined" \
  --tasks-dir "tasks" \
  --runs-dir "output/Bio_runs" \
  --max-rounds 5 \
  --timeout-seconds 7200 \
  --temperature 1 \
  --thinking disabled \
  --agent-runtime source
```

## 📁 任务结构

每个combined任务包含：

```
tasks/25303977_combined/
├── task_manifest.json      # 任务配置（judge入口点）
├── queries.md              # 合并的所有子任务查询
├── README.md               # 任务说明
├── cot_instructions.md     # 思维链指令
├── requirements.txt        # Python依赖
├── workdir/               # 工作数据（符号链接）
├── data/                  # 原始数据（符号链接）
├── envs/                  # 环境配置（符号链接）
└── evaluation/
    ├── judge.py           # Judge包装器 ✅
    ├── run_reference.py   # 输出加载器 ✅
    ├── test_cases.py      # 断言测试
    ├── reference_answer.py
    ├── prefix.py
    └── metrics.json
```

## ✅ Judge系统验证

Judge系统已通过完整测试（25303977_combined，5轮评估，21分钟）：

1. **✅ 正确加载AI输出**: 从submission目录加载所有.pkl文件
2. **✅ 正确执行断言**: 运行test_cases.py中的所有测试
3. **✅ 提供详细反馈**: 返回具体的错误信息和行号
4. **✅ 支持迭代**: AI根据反馈进行5轮迭代

### Judge工作流程

```
AI提交 → judge.py包装器 → 设置BIODSBENCH_OUTPUTS_DIR
       → run_reference.py → 加载.pkl文件到命名空间
       → test_cases.py → 执行断言测试
       → 返回结果和反馈
```

## 📊 输出格式

AI需要为每个变量生成pickle文件：

```python
import pickle

# 示例：保存变量到outputs目录
with open('outputs/substitution_ratios.pkl', 'wb') as f:
    pickle.dump(substitution_ratios, f)

with open('outputs/most_frequent_substitution.pkl', 'wb') as f:
    pickle.dump(most_frequent_substitution, f)
```

## 📝 日志和结果

### 批量运行日志

```
logs/batch_runs/
├── batch_run_20250119_143000.log      # 批次汇总日志
├── 25303977_combined_20250119_143000.log
├── 27959731_combined_20250119_144500.log
└── ...
```

### 评估结果

```
output/Bio_runs/
├── 25303977_combined/
│   ├── run_20250119_143000/
│   │   ├── result.json          # 最终结果
│   │   ├── trajectory.json      # 完整轨迹
│   │   └── rounds/
│   │       ├── round_1/
│   │       ├── round_2/
│   │       └── ...
```

## 🔧 故障排查

### 问题1: Judge找不到输出文件

**原因**: AI没有将结果保存为pickle文件

**解决**: 确保AI代码包含：
```python
import pickle
import os

os.makedirs('outputs', exist_ok=True)
with open('outputs/variable_name.pkl', 'wb') as f:
    pickle.dump(variable_value, f)
```

### 问题2: 断言失败

**原因**: AI的输出不符合预期格式或值

**解决**: 查看judge反馈中的具体错误信息，例如：
```
AssertionError at line 15: Expected row 2: GG>AA, 2796
```

### 问题3: 任务超时

**原因**: 任务太复杂，AI无法在时间限制内完成

**解决**: 增加timeout参数：
```bash
--timeout-seconds 10800  # 3小时
```

## 📈 预期运行时间

基于25303977_combined的测试结果：

- **单轮时间**: 约4分钟
- **5轮总时间**: 约21分钟
- **13个任务总时间**: 约4.5小时（假设每个任务21分钟）

## 🎯 下一步

1. **测试第二个任务**: 验证其他任务的judge配置
   ```bash
   ./run_biodsbench.sh 27959731_combined
   ```

2. **批量运行**: 如果测试通过，启动批量运行
   ```bash
   nohup ./run_all_combined_tasks.sh > batch_run.log 2>&1 &
   ```

3. **监控进度**: 查看日志
   ```bash
   tail -f batch_run.log
   tail -f logs/batch_runs/batch_run_*.log
   ```

## 📞 支持

如果遇到问题：

1. 检查judge日志: `output/Bio_runs/<task_name>/run_*/rounds/round_*/judge_output.txt`
2. 检查AI输出: `output/Bio_runs/<task_name>/run_*/rounds/round_*/submission/`
3. 验证pickle文件: `ls -lh output/Bio_runs/<task_name>/run_*/rounds/round_*/submission/*.pkl`

---

**创建时间**: 2025-01-19  
**状态**: ✅ Judge系统已验证，准备批量运行
