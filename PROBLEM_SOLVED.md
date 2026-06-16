# ✅ 问题已解决 - 2026-05-29

## 问题
运行 `python3 run_method2_batch.py --study 29713087 --max-rounds 3` 时，所有子任务都失败：
```
❌ 验证失败: Error during test execution: NameError: name 'num_patients' is not defined
```

## 根本原因
`incremental_evaluator.py` 中pickle文件加载逻辑有bug：
- 把字典pickle文件作为整体赋值给一个变量（如 `results`）
- 而不是展开字典的键值对到namespace
- 导致测试用例无法访问字典内的变量

## 修复
修改 `incremental_evaluator.py` 第37-56行，让pickle加载逻辑与JSON保持一致：

```python
# 修复前
namespace[var_name] = pickle.load(f)  # ❌

# 修复后
data = pickle.load(f)
if isinstance(data, dict):
    namespace.update(data)  # ✅ 展开字典
else:
    namespace[var_name] = data
```

## 验证结果

### 手动测试
```bash
python3 incremental_evaluator.py \
  --task-dir tasks/29713087_0 \
  --outputs-dir output/Bio_runs/.../29713087_0_.../outputs \
  --result /tmp/test_eval.json
```
✅ **结果**: PASS - All test cases passed

### 实际运行
```bash
python3 run_method2_batch.py --study 29713087 --max-rounds 3
```
✅ **进展**（截至17:00）:
- 子任务0: 通过（第3轮，前2轮是修复前）
- 子任务1: 通过（第1轮）
- 子任务2+: 运行中

## 影响范围
- 所有将结果保存为字典pickle文件的子任务
- 可能影响多个母任务的历史运行结果

## 详细文档
- [BUG_FIX_SUMMARY.md](BUG_FIX_SUMMARY.md) - 完整的bug分析和修复说明
- [METHOD2_BATCH_RUN_RECORD.md](METHOD2_BATCH_RUN_RECORD.md) - 运行记录

---
**修复时间**: 2026-05-29 16:50  
**状态**: ✅ 已修复并验证
