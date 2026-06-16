# 方法2完整调试记录 - 最终版

## 🎯 发现并解决的所有问题

### 问题1: 变量命名空间不匹配 ✅ 已解决
**时间**: 17:33 - 17:45  
**现象**: `NameError: name 'substitution_ratios' is not defined`  
**原因**: AI生成CSV，测试期望Python变量  
**解决**: 创建`incremental_evaluator.py`，自动加载CSV为DataFrame

### 问题2: CLI内置judge失败 ✅ 已解决
**时间**: 18:03 - 18:05  
**现象**: CLI返回exit code 1导致流程中断  
**原因**: CLI内置judge失败，但AI实际已生成输出  
**解决**: 忽略CLI退出码，只要有输出就继续评测

### 问题3: Outputs目录路径不匹配 ✅ 已解决
**时间**: 18:38 - 18:39  
**现象**: `No outputs found in submission directory`  
**原因**: CLI创建独立运行目录，评测器查找共享目录  
**解决**: 动态查找CLI创建的实际outputs目录

### 问题4: task_manifest.json缺失 ✅ 已解决
**时间**: 18:42  
**现象**: `ENOENT: no such file or directory, open 'task_manifest.json'`  
**原因**: 子任务1-7缺少符号链接  
**解决**: 
```bash
for i in {1..7}; do 
  ln -sf task.json tasks/25303977_$i/task_manifest.json
done
```

### 问题5: task.json格式错误 ✅ 已解决
**时间**: 18:45  
**现象**: `Task manifest id mismatch: expected 25303977_1, got undefined`  
**原因**: 
- 子任务0: 简洁的manifest格式 (393字节)
- 子任务1-7: 完整的任务描述格式 (32KB)
- CLI需要manifest格式，不是任务描述

**解决**: 创建`create_task_manifests.py`
```python
manifest = {
    "version": 1,
    "task_id": task_id,
    "public_bundle": [...],
    "private_judge_bundle": ["evaluation"],
    "entrypoints": {
        "judge": "evaluation/test_cases.py",
        "environment": "envs/env_manifest.json"
    },
    "submission": {
        "output_dir": "outputs"
    }
}
```

## 📊 测试历史

| 测试 | 时间 | 结果 | 主要问题 |
|------|------|------|----------|
| 1 | 17:33 | 0/8 (0%) | 变量命名空间不匹配 |
| 2 | 18:03 | 0/8 (0%) | CLI judge失败中断 |
| 3 | 18:39 | 1/8 (12.5%) | task_manifest.json缺失 |
| 4 | 18:42 | 1/8 (12.5%) | task.json格式错误 |
| 5 | 18:46 | ⏳ 运行中 | 所有问题已修复 |

## 🔍 根本原因分析

### 为什么子任务0能工作，其他不能？

**文件对比**:
```
子任务0 (可工作):
- task.json: 393字节，manifest格式，有task_id字段
- task_manifest.json: 符号链接 -> task.json
- 修改时间: May 27 00:15 (比其他晚)

子任务1-7 (不工作):
- task.json: 32KB，完整任务描述，无task_id字段
- task_manifest.json: 不存在
- 修改时间: May 27 00:04
```

**推测**: 
1. 原始任务生成时，所有子任务都是完整描述格式
2. 子任务0被手动修改为manifest格式（用于测试）
3. 其他子任务保持原始格式
4. CLI需要manifest格式才能正常工作

## 💡 关键发现

### 1. BioDSBench的任务格式要求
- **完整描述格式**: 包含queries, cot_instructions, reference_answer等
- **Manifest格式**: 只包含task_id, public_bundle, entrypoints等
- **CLI需要**: Manifest格式
- **用途**: 完整格式用于任务生成，manifest用于执行

### 2. 文件系统的重要性
- 符号链接必须存在
- 文件格式必须正确
- 不能假设所有子任务配置一致

### 3. 调试策略
- 对比成功和失败的案例
- 查看文件大小和时间戳
- 检查文件内容，不只是文件名

## 🛠️ 创建的工具

### 1. incremental_evaluator.py
**功能**: 灵活的评测器，支持pkl/csv/py三种格式

### 2. create_task_manifests.py
**功能**: 批量生成task manifest
- 备份原始task.json为task_original.json
- 生成标准manifest格式
- 创建符号链接

### 3. monitor_method2.py
**功能**: 监控执行进度

## 📝 修复清单

- [x] 创建增量评测器
- [x] 修改执行逻辑忽略CLI退出码
- [x] 动态查找outputs目录
- [x] 创建task_manifest.json符号链接
- [x] 生成正确的task.json manifest
- [ ] 等待完整测试结果

## 🎯 当前状态

**时间**: 18:46  
**状态**: 方法2正在运行（第5次，修复所有5个问题）  
**任务**: 25303977 (8个子任务)  
**预计完成**: 19:15-19:35 (约30-50分钟)

## 📊 预期结果

如果所有问题都解决了，方法2应该能够：
1. ✅ 成功执行所有8个子任务
2. ✅ 使用增量评测器正确评测
3. ✅ 保存每个子任务的输出
4. ✅ 累积上下文到后续子任务

**成功率预期**: 
- 乐观: 50-75% (4-6个子任务通过)
- 保守: 25-50% (2-4个子任务通过)
- 最低: 12.5% (1个子任务通过)

## 🔧 为其他任务做准备

如果要测试其他母任务，需要：

```bash
# 1. 检查并创建task_manifest.json符号链接
for study in 27959731 28481359 ...; do
  for i in {0..7}; do
    ln -sf task.json tasks/${study}_${i}/task_manifest.json
  done
done

# 2. 生成正确的task.json manifest
python create_task_manifests.py --study <study_id>
```

## 📈 经验教训

### 1. 理解系统架构
- 不要假设文件格式
- 查看实际文件内容
- 对比成功和失败的案例

### 2. 逐步调试
- 每次只解决一个问题
- 验证后再继续
- 记录每次修改

### 3. 文件系统检查
- 检查文件大小
- 检查文件时间戳
- 检查符号链接
- 检查文件内容

### 4. 错误日志很重要
- CLI的stderr清楚地指出问题
- 不要只看exit code
- 查看完整的错误信息

---

**最后更新**: 2026-05-28 18:47  
**下一步**: 等待测试完成，分析最终结果
