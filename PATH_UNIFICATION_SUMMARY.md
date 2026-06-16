# 工作目录统一 - 修复总结

> **完成时间**: 2026-05-31  
> **问题**: AI在子任务5中使用错误的相对路径`../public/workdir/`导致失败  
> **解决方案**: 在系统提示中明确路径使用规范

---

## 🎯 问题根源

### 现象
- **28481359子任务5**: AI使用`../public/workdir/`路径，评测时失败
- **28481359子任务2,3,4**: AI使用`public/workdir/`路径，评测成功

### 根本原因

**AI的工作流程**：
1. AI在`runDir`（run root）工作
2. AI在`workspace/`目录中创建探索脚本（如`explore_data.py`）
3. AI可能在`workspace/`目录中运行脚本
4. 从`workspace/`看，数据路径是`../public/workdir/`
5. AI学到这个路径，在最终`solver.py`中也使用`../public/workdir/`
6. 评测器从`runDir`执行`solver.py`，此时`../public/workdir/`路径错误

**目录结构**：
```
runDir/
├── public/
│   └── workdir/          # 数据文件
│       ├── data1.csv
│       └── data2.csv
├── workspace/            # AI工作区
│   ├── explore_data.py   # 探索脚本
│   └── solver.py         # 最终代码
└── outputs/              # 输出目录
```

**路径对比**：
- 从`runDir`看：`public/workdir/data1.csv` ✅
- 从`workspace/`看：`../public/workdir/data1.csv` ✅
- 评测器从`runDir`执行：`../public/workdir/data1.csv` ❌（指向runDir的父目录）

---

## ✅ 解决方案

### 修改内容

**文件**: `src/harness/evaluation/sourceContextBuilder.ts`

**修改位置**: `<workflow>`部分

**修改前**：
```typescript
'<workflow>',
'1. Use <output_contract> and <visible_cases> as the submission contract...',
'2. Once you understand the task, write...',
'3. Write solver code under workspace/ and longer experiments under workspace/experiments/.',
'4. Use Bash for short commands or to run scripts...',
'5. Run a bounded set of focused experiments...',
'6. Write final submission files under outputs/...',
'7. Call finalize_submission...',
'</workflow>',
```

**修改后**：
```typescript
'<workflow>',
'1. Use <output_contract> and <visible_cases> as the submission contract...',
'2. Once you understand the task, write...',
'3. Write solver code under workspace/ and longer experiments under workspace/experiments/.',
'4. IMPORTANT: Your cwd is run root. Always use paths relative to run root. Data files are at public/workdir/, NOT ../public/workdir/. When writing code in workspace/, use public/workdir/ for data paths.',
'5. Use Bash for short commands or to run scripts...',
'6. Run a bounded set of focused experiments...',
'7. Write final submission files under outputs/...',
'8. Call finalize_submission...',
'</workflow>',
```

### 关键变化

**新增第4步**：
```
IMPORTANT: Your cwd is run root. Always use paths relative to run root. 
Data files are at public/workdir/, NOT ../public/workdir/. 
When writing code in workspace/, use public/workdir/ for data paths.
```

**明确告诉AI**：
1. 工作目录是run root
2. 始终使用从run root的相对路径
3. 数据文件路径：`public/workdir/`
4. 不要使用`../public/workdir/`
5. 即使在workspace/中写代码，也要使用`public/workdir/`

---

## 📊 预期效果

### 修复前
```python
# AI在workspace/explore_data.py中
df = pd.read_csv('../public/workdir/data.csv')  # ✅ 从workspace/运行成功

# AI在workspace/solver.py中
df = pd.read_csv('../public/workdir/data.csv')  # ❌ 评测器从runDir执行失败
```

### 修复后
```python
# AI在workspace/explore_data.py中
df = pd.read_csv('public/workdir/data.csv')  # ✅ 从runDir运行成功

# AI在workspace/solver.py中
df = pd.read_csv('public/workdir/data.csv')  # ✅ 评测器从runDir执行成功
```

### 影响范围

**受益任务**：
- 所有使用数据文件的任务
- 特别是需要在workspace/中探索数据的任务

**不受影响**：
- 已经使用正确路径的任务（如28481359的子任务2,3,4）
- 不使用数据文件的任务

---

## 🔍 验证计划

### 验证步骤

1. **重新运行28481359_5**：
   ```bash
   python run_method2_batch.py --study 28481359 --max-rounds 3
   ```

2. **检查AI生成的代码**：
   - 查看`workspace/solver.py`中的路径
   - 确认使用`public/workdir/`而非`../public/workdir/`

3. **验证评测结果**：
   - 子任务5应该通过（如果AI逻辑正确）
   - 或者至少不再出现路径错误

### 成功标准

- ✅ AI在所有代码中使用`public/workdir/`路径
- ✅ 评测器能够成功执行AI代码
- ✅ 不再出现`FileNotFoundError: ../public/workdir/xxx.csv`

---

## 📝 相关文档

- **问题分析**: [PATH_FIX_PLAN.md](PATH_FIX_PLAN.md)
- **失败分析**: [FAILURE_ANALYSIS_REPORT.md](FAILURE_ANALYSIS_REPORT.md)
- **评测器修复**: [EVALUATOR_FIX_FINAL_REPORT.md](EVALUATOR_FIX_FINAL_REPORT.md)

---

## 🎉 总结

**问题**：AI在探索阶段学到的相对路径，在评测阶段失效

**根源**：AI可能在workspace/目录中运行探索脚本，导致相对路径不一致

**解决**：在系统提示中明确告诉AI始终使用从run root的相对路径

**效果**：统一了AI探索和评测执行的路径规范，避免路径错误

**状态**：✅ 已完成修改，等待验证

---

**修改文件**: `src/harness/evaluation/sourceContextBuilder.ts`  
**修改行数**: 1行新增（第216行）  
**影响范围**: 所有使用BioDSBench评测系统的任务
