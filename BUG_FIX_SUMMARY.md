# Bug修复总结 - 2026-05-29

## 🐛 问题描述

### 症状
在运行 `run_method2_batch.py --study 29713087` 时，所有子任务都失败并报错：
```
❌ 验证失败: Error during test execution: NameError: name 'num_patients' is not defined
```

### 表现
- CLI正常执行，生成了 `results.pkl` 文件
- pickle文件包含正确的数据：`{'num_patients': 135, 'samples_per_patient': DataFrame}`
- 但测试用例无法访问 `num_patients` 和 `samples_per_patient` 变量

## 🔍 根本原因

### 问题定位
在 `incremental_evaluator.py` 的 `load_submission_outputs()` 方法中：

**Bug代码（第45行）**：
```python
with open(pkl_path, 'rb') as f:
    namespace[var_name] = pickle.load(f)  # ❌ 错误
```

这会把整个字典作为一个变量赋值：
- `namespace['results'] = {'num_patients': 135, 'samples_per_patient': df}`
- 测试用例需要 `num_patients`，但实际只有 `results['num_patients']`

### 对比：JSON加载逻辑（正确）
```python
data = json.load(f)
if isinstance(data, dict):
    namespace.update(data)  # ✅ 正确：展开字典
```

## ✅ 修复方案

### 修改文件
`incremental_evaluator.py` 第37-56行

### 修复代码
```python
# 方法1: 尝试加载pickle文件
pkl_files = list(self.outputs_dir.glob("*.pkl"))
if pkl_files:
    print(f"✓ 找到 {len(pkl_files)} 个pickle文件")
    for pkl_path in pkl_files:
        var_name = pkl_path.stem
        try:
            with open(pkl_path, 'rb') as f:
                data = pickle.load(f)
            # 如果pickle是字典，将其键值对展开到namespace（与JSON逻辑一致）
            if isinstance(data, dict):
                namespace.update(data)  # ✅ 修复：展开字典
                print(f"  - 从 {pkl_path.name} 展开了 {len(data)} 个变量")
            else:
                namespace[var_name] = data
                print(f"  - 加载 {var_name} from {pkl_path.name}")
        except Exception as e:
            print(f"  ✗ 加载 {pkl_path.name} 失败: {e}")
```

### 关键改动
1. 先加载到临时变量 `data`
2. 检查是否为字典：`isinstance(data, dict)`
3. 如果是字典，展开到namespace：`namespace.update(data)`
4. 如果不是字典，保持原逻辑：`namespace[var_name] = data`

## 🧪 验证

### 手动测试
```bash
python3 incremental_evaluator.py \
  --task-dir /home/yjh/my_claude/tasks/29713087_0 \
  --outputs-dir /home/yjh/my_claude/output/Bio_runs/29713087_incremental_20260529_161823/29713087_0_20260529_161823/outputs \
  --result /tmp/test_eval.json
```

**结果**：
```
✓ 找到 1 个pickle文件
  - 从 results.pkl 展开了 2 个变量
✓ 找到 1 个CSV文件
  - 加载了 2 个变量

============================================================
评测结果: PASS
得分: 1
反馈: All test cases passed
============================================================
```

### 实际运行测试
```bash
python3 run_method2_batch.py --study 29713087 --max-rounds 3
```

**结果**（截至16:59）：
- ✅ 子任务0: 第3轮通过（前2轮是修复前的失败）
- ✅ 子任务1: 第1轮通过
- 🔄 子任务2: 运行中

## 📊 影响范围

### 受影响的场景
所有AI将结果保存为**字典pickle文件**的子任务，例如：
```python
output_data = {
    'num_patients': num_patients,
    'samples_per_patient': samples_per_patient
}
with open('outputs/results.pkl', 'wb') as f:
    pickle.dump(output_data, f)
```

### 不受影响的场景
1. 直接保存变量（非字典）的pickle文件
2. JSON文件（已有正确的展开逻辑）
3. CSV文件（直接加载为DataFrame）
4. Python代码文件（通过exec执行）

## 🎯 后续行动

### 立即
- [x] 修复 `incremental_evaluator.py`
- [x] 验证修复有效
- [ ] 等待29713087完整运行结果

### 短期
- [ ] 重新运行之前失败的母任务（可能受此bug影响）
- [ ] 更新 `METHOD2_BATCH_RUN_RECORD.md`

### 长期
- [ ] 添加单元测试覆盖pickle字典展开逻辑
- [ ] 文档化输出文件格式最佳实践

## 📝 经验教训

1. **一致性原则**：不同格式（pickle/JSON/CSV）的加载逻辑应保持一致
2. **测试覆盖**：应该有单元测试覆盖各种输出格式
3. **错误信息**：`NameError: name 'num_patients' is not defined` 看起来像测试用例问题，实际是加载器问题
4. **调试方法**：手动运行评测器可以快速定位问题

## 🔗 相关文件

- `incremental_evaluator.py` - 修复的文件
- `study_task_executor.py` - 调用评测器的执行器
- `METHOD2_BATCH_RUN_RECORD.md` - 运行记录
- `tasks/29713087_0/` - 测试用例

---

**修复时间**: 2026-05-29 16:50  
**修复人**: AI助手  
**验证状态**: ✅ 已验证有效
