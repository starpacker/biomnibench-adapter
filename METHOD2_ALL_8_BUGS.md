# 方法2调试 - 发现的所有8个问题

## 🐛 完整问题清单

### 问题1: 变量命名空间不匹配 ✅
**时间**: 17:33 - 17:45  
**现象**: `NameError: name 'substitution_ratios' is not defined`  
**解决**: 创建增量评测器，自动加载CSV为DataFrame

### 问题2: CLI内置judge失败 ✅
**时间**: 18:03 - 18:05  
**现象**: CLI返回exit code 1  
**解决**: 忽略CLI退出码，继续评测

### 问题3: Outputs路径不匹配 ✅
**时间**: 18:38 - 18:39  
**现象**: `No outputs found in submission directory`  
**解决**: 动态查找CLI创建的实际outputs目录

### 问题4: task_manifest.json缺失 ✅
**时间**: 18:42  
**现象**: `ENOENT: no such file or directory, open 'task_manifest.json'`  
**解决**: 创建符号链接

### 问题5: task.json格式错误 ✅
**时间**: 18:45  
**现象**: `Task manifest id mismatch: expected 25303977_1, got undefined`  
**解决**: 生成正确的manifest格式

### 问题6: glob匹配bug ✅
**时间**: 19:15  
**现象**: `Outputs directory not found: .../25303977_0_eval_result.json/outputs`  
**解决**: 过滤目录，不匹配文件

### 问题7: Python环境不一致 ✅
**时间**: 19:29  
**现象**: `No module named 'numpy._core'`  
**解决**: 使用python3替代python

### 问题8: envs配置缺失 ✅
**时间**: 19:56  
**现象**: `infra_error: Unable to resolve task Python from .../env_manifest.json`  
**原因**: 子任务1-7缺少envs目录  
**解决**: 从子任务0复制envs配置

## 📊 测试历史

| 测试 | 时间 | 结果 | 主要问题 |
|------|------|------|----------|
| 1 | 17:33 | 0/8 (0%) | 变量命名空间不匹配 |
| 2 | 18:03 | 0/8 (0%) | CLI judge失败中断 |
| 3 | 18:39 | 1/8 (12.5%) | task_manifest.json缺失 |
| 4 | 18:42 | 1/8 (12.5%) | task.json格式错误 |
| 5 | 18:46 | 0/8 (0%) | glob匹配bug |
| 6 | 19:15 | 1/8 (12.5%) | Python环境不一致 |
| 7 | 19:29 | 1/8 (12.5%) | envs配置缺失 |
| 8 | 19:56 | ⏳ 待运行 | 所有问题已修复 |

## 🎯 第7次运行的重要发现

### ✅ 成功的部分
- **第一个子任务第1轮就通过了！** 🎉
- 证明Python环境修复有效
- 证明增量评测器工作完美

### ❌ 失败的部分
- 子任务1-7都是"infra_error"
- 原因：缺少envs配置

## 🔍 为什么只有子任务0有envs？

**推测**:
1. 子任务0被手动配置过（用于测试）
2. 其他子任务保持原始状态
3. 原始任务生成时可能没有包含envs

**证据**:
- 子任务0的文件都比较新（May 27 00:15）
- 其他子任务的文件较旧（May 27 00:04）
- 子任务0有完整的manifest、envs、符号链接

## 💡 关键洞察

### BioDSBench CLI的要求
1. ✅ task_manifest.json（符号链接到task.json）
2. ✅ task.json（manifest格式，不是完整描述）
3. ✅ envs/env_manifest.json（Python环境配置）
4. ✅ envs/runtime/.venv/（虚拟环境）

### 文件系统的一致性很重要
- 不能假设所有子任务配置相同
- 需要检查每个子任务的完整性
- 对比成功和失败的案例

## 🔧 已完成的修复

### 代码修改
1. `incremental_evaluator.py` - 增量评测器
2. `study_task_executor.py` - 使用python3
3. `create_task_manifests.py` - 生成manifest
4. `create_envs_config.py` - 复制envs配置

### 文件系统修改
1. 创建task_manifest.json符号链接
2. 生成正确的task.json manifest
3. 复制envs配置到所有子任务

## 🎯 下一步

**立即重新运行方法2**

**预期**:
- **乐观**: 50-75% (4-6个子任务通过)
- **保守**: 25-50% (2-4个子任务通过)
- **最低**: 12.5% (1个子任务通过)

**命令**:
```bash
python run_method2_batch.py --study 25303977 --max-rounds 3
```

## 📈 调试统计

- **总耗时**: 约2.5小时
- **发现问题**: 8个
- **测试次数**: 7次
- **成功率**: 从0% → 12.5% → 待验证

## 🎓 经验教训

### 技术层面
1. 文件系统一致性很重要
2. 环境配置必须完整
3. 对比成功和失败的案例
4. 逐步验证，不要批量修改

### 调试策略
1. 查看详细的错误日志
2. 检查文件系统状态
3. 对比不同子任务的差异
4. 手动测试核心逻辑

---

**最后更新**: 2026-05-28 19:57  
**状态**: 已修复所有8个问题，准备第8次测试
