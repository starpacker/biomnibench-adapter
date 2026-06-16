# 方法2调试 - 完整问题清单

## 🐛 发现并解决的所有6个问题

### 问题1: 变量命名空间不匹配 ✅
**时间**: 17:33 - 17:45  
**现象**: `NameError: name 'substitution_ratios' is not defined`  
**原因**: AI生成CSV，测试期望Python变量  
**解决**: 创建`incremental_evaluator.py`

### 问题2: CLI内置judge失败 ✅
**时间**: 18:03 - 18:05  
**现象**: CLI返回exit code 1  
**原因**: CLI内置judge失败导致流程中断  
**解决**: 忽略CLI退出码

### 问题3: Outputs路径不匹配 ✅
**时间**: 18:38 - 18:39  
**现象**: `No outputs found in submission directory`  
**原因**: CLI创建独立目录，评测器查找共享目录  
**解决**: 动态查找CLI创建的实际outputs目录

### 问题4: task_manifest.json缺失 ✅
**时间**: 18:42  
**现象**: `ENOENT: no such file or directory, open 'task_manifest.json'`  
**原因**: 子任务1-7缺少符号链接  
**解决**: 创建符号链接

### 问题5: task.json格式错误 ✅
**时间**: 18:45  
**现象**: `Task manifest id mismatch: expected 25303977_1, got undefined`  
**原因**: task.json是完整描述格式(32KB)，不是manifest格式(393B)  
**解决**: 生成正确的manifest格式

### 问题6: glob匹配bug ✅
**时间**: 19:15  
**现象**: `Outputs directory not found: .../25303977_0_eval_result.json/outputs`  
**原因**: `glob(f"{task_id}_*")` 匹配到了 `{task_id}_eval_result.json` 文件  
**解决**: 
```python
# 修改前
task_run_dirs = sorted(self.run_dir.glob(f"{task_id}_*"), reverse=True)

# 修改后
task_run_dirs = [d for d in self.run_dir.glob(f"{task_id}_*") if d.is_dir()]
task_run_dirs = sorted(task_run_dirs, reverse=True)
```

## 📊 测试历史

| 测试 | 时间 | 结果 | 主要问题 |
|------|------|------|----------|
| 1 | 17:33 | 0/8 (0%) | 变量命名空间不匹配 |
| 2 | 18:03 | 0/8 (0%) | CLI judge失败中断 |
| 3 | 18:39 | 1/8 (12.5%) | task_manifest.json缺失 |
| 4 | 18:42 | 1/8 (12.5%) | task.json格式错误 |
| 5 | 18:46 | 0/8 (0%) | glob匹配bug |
| 6 | 19:15 | ⏳ 运行中 | 所有问题已修复 |

## 🔍 问题分析

### 为什么问题这么多？

1. **系统复杂性**: BioDSBench有多层抽象
   - CLI层
   - 任务定义层
   - 评测层
   - 文件系统层

2. **文档不足**: 
   - task.json有两种格式（描述 vs manifest）
   - 没有明确说明CLI需要manifest格式
   - 符号链接要求没有文档化

3. **不一致的初始状态**:
   - 子任务0被手动修改过
   - 其他子任务保持原始状态
   - 导致假设错误

4. **边界情况**:
   - glob匹配文件和目录
   - 路径查找逻辑复杂
   - 错误处理不完善

## 💡 调试策略总结

### 有效的策略

1. **对比分析**: 对比成功和失败的案例
2. **查看日志**: CLI的stderr提供关键信息
3. **检查文件系统**: 文件大小、时间戳、内容
4. **逐步验证**: 每次只解决一个问题
5. **手动测试**: 验证核心逻辑正确性

### 无效的策略

1. **假设一致性**: 假设所有子任务配置相同
2. **只看exit code**: 忽略详细错误信息
3. **批量修改**: 一次改太多东西

## 🎯 当前状态

**时间**: 19:15  
**状态**: 方法2正在运行（第6次，修复所有6个问题）  
**任务**: 25303977 (8个子任务)  
**预计完成**: 19:45-20:05

## 📝 修复清单

- [x] 创建增量评测器
- [x] 修改执行逻辑忽略CLI退出码
- [x] 动态查找outputs目录
- [x] 创建task_manifest.json符号链接
- [x] 生成正确的task.json manifest
- [x] 修复glob匹配bug
- [ ] 等待完整测试结果

## 🔧 代码修改汇总

### 1. incremental_evaluator.py (新文件)
```python
# 支持pkl/csv/py三种格式
for csv_path in self.outputs_dir.glob("*.csv"):
    var_name = csv_path.stem
    namespace[var_name] = pd.read_csv(csv_path)
```

### 2. study_task_executor.py
```python
# 修改1: 忽略CLI退出码
if not cli_result["success"]:
    print(f"⚠️ CLI返回失败（可能是内置judge失败），检查输出文件...")
# 继续评测

# 修改2: 动态查找outputs目录
task_run_dirs = [d for d in self.run_dir.glob(f"{task_id}_*") if d.is_dir()]
latest_run_dir = task_run_dirs[0]
actual_outputs_dir = latest_run_dir / "outputs"
```

### 3. create_task_manifests.py (新文件)
```python
# 生成manifest格式
manifest = {
    "version": 1,
    "task_id": task_id,
    "public_bundle": [...],
    ...
}
```

### 4. 文件系统修改
```bash
# 创建符号链接
for i in {1..7}; do 
  ln -sf task.json tasks/25303977_$i/task_manifest.json
done

# 生成manifest
python create_task_manifests.py
```

## 📊 预期结果

如果所有问题都解决了：
- **乐观**: 50-75% (4-6个子任务通过)
- **保守**: 25-50% (2-4个子任务通过)
- **最低**: 12.5% (1个子任务通过)

## 🎓 经验教训

### 技术层面
1. 文件系统操作要小心（glob, 符号链接）
2. 路径处理要考虑边界情况
3. 错误处理要完善
4. 日志要详细

### 调试层面
1. 对比成功和失败的案例
2. 查看详细的错误日志
3. 检查文件系统状态
4. 逐步验证，不要批量修改
5. 手动测试核心逻辑

### 系统设计层面
1. 文档很重要
2. 一致性很重要
3. 错误信息要清晰
4. 边界情况要考虑

---

**最后更新**: 2026-05-28 19:16  
**下一步**: 等待测试完成，分析最终结果
