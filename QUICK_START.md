# BioDSBench 快速启动指南

## ✅ 系统状态：就绪

所有准备工作已完成，可以立即开始测评！

## 🚀 三种运行方式

### 1️⃣ 小规模测试（推荐首次运行）
```bash
cd /home/yjh/my_claude
./run_small_test.sh
```
- **测评内容**：3个母任务，19个子任务
- **预计时间**：2-4小时
- **适用场景**：验证系统是否正常工作

### 2️⃣ 单个母任务测试
```bash
cd /home/yjh/my_claude
python3 batch_serial_executor.py --studies 34819518
```
- **测评内容**：1个母任务，6个子任务
- **预计时间**：30分钟-1小时
- **适用场景**：快速测试或调试

### 3️⃣ 完整测评
```bash
cd /home/yjh/my_claude
./run_biodsbench_full.sh
```
- **测评内容**：13个母任务，118个子任务
- **预计时间**：数小时到十几小时
- **适用场景**：正式评测

## 📊 监控进度

### 实时查看日志
```bash
tail -f /data/yjh/biodsbench-serial-results/batch_run.log
```

### 查看当前状态
```bash
cat /data/yjh/biodsbench-serial-results/batch_*/batch_state.json | jq
```

## 📁 结果位置

```
/data/yjh/biodsbench-serial-results/batch_*/
├── batch_state.json      # 总体结果
├── 25303977/            # 各母任务结果
└── batch_run.log        # 完整日志
```

## 🆘 遇到问题？

查看详细文档：
- `FINAL_SUMMARY.md` - 完整总结
- `EXECUTION_PLAN.md` - 执行计划
- `IMPLEMENTATION_SUMMARY.md` - 技术细节

## 📈 已完成的验证

✅ Python环境修复（131个任务）
✅ 单子任务测试通过（34819518_0）
✅ API配置正确
✅ 增量评测器工作正常
✅ BioMniBench数据整理完成（52个任务）
✅ 完整轨迹保存（代码、上下文、评测详情）

## 🔍 新增功能：完整轨迹保存

系统现在会自动保存以下信息，用于后续深度分析：

### 每个子任务的每一轮都保存：
- ✅ **AI生成的完整代码** (`generated_code.py`)
- ✅ **任务描述** (`task_description.txt`)
- ✅ **上下文信息** (`context.json`) - 包含前面子任务的代码和描述
- ✅ **CLI执行日志** (`cli_output.log`)
- ✅ **Agent轨迹** (`agent_traces/`)
- ✅ **详细评测结果** (`eval_detailed.json`)

### 分析工具：
```bash
# 分析整个批次
python3 analyze_traces.py --batch-dir /data/yjh/biodsbench-serial-results/batch_*

# 分析单个母任务
python3 analyze_traces.py --batch-dir /data/... --study-id 25303977

# 深度分析单个子任务
python3 analyze_traces.py --batch-dir /data/... --task-id 25303977_0

# 导出所有失败案例
python3 analyze_traces.py --batch-dir /data/... --export-failures failures.json
```

详见：`TRACE_ANALYSIS_GUIDE.md`

---

**准备完毕，可以开始了！** 🎯
