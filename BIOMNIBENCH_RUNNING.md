# ✅ BioMniBench 测评正在运行中

## 📊 系统状态

**测评已启动！** 使用 claude-4.7-opus (Vendor2/Claude-4.7-opus) + qwen3.5-plus Judge

- **任务总数**: 50 个 da- 任务
- **预计时间**: 4-8 小时
- **当前状态**: 正在执行中
- **Session**: `tmux session: biomnibench`

## 🔍 监控命令

### 查看实时进度
```bash
tmux attach -t biomnibench
# 分离: Ctrl+B, D
```

### 查看最新日志
```bash
tail -f /data/yjh/biomnibench-results/run_direct_*.log
```

### 查看进度统计
```bash
ls /data/yjh/biomnibench-results/da-*_*/judge_result.json | wc -l
# 显示已完成的任务数
```

### 查看最新结果
```bash
LATEST_SUMMARY=$(ls -t /data/yjh/biomnibench-results/summary_*.json | head -1)
cat $LATEST_SUMMARY | jq '.completed, .total'
```

## 📁 输出文件

```
/data/yjh/biomnibench-results/
├── da-1-3_TIMESTAMP/
│   ├── trace.md           # Claude 生成的分析轨迹
│   ├── answer.txt         # 最终答案
│   └── judge_result.json  # Qwen Judge 评分
├── da-1-4_TIMESTAMP/
│   └── ...
├── summary_TIMESTAMP.json # 测评总结（实时更新）
└── run_direct_TIMESTAMP.log # 完整日志
```

## 📈 查看已完成任务的评分

```bash
for f in /data/yjh/biomnibench-results/da-*/judge_result.json; do
  TASK=$(dirname $f | xargs basename)
  SCORE=$(jq -r '.total_score' $f 2>/dev/null)
  echo "$TASK: $SCORE/100"
done | sort
```

## ⚠️ 注意事项

1. **不要关闭终端** - 测评在 tmux 中运行，即使断开 SSH 也会继续
2. **API 限流** - 每个任务间隔 5 秒，避免限流
3. **评分可能较低** - 当前提示较简单，可能需要优化
4. **磁盘空间** - 每任务约 1-10 MB

## 🛠️ 故障排查

### 如果测评停止了
```bash
# 检查是否还在运行
tmux ls
ps aux | grep run_biomnibench_direct

# 查看最后的错误
tail -100 /data/yjh/biomnibench-results/run_direct_*.log
```

### 从指定任务继续
```bash
cd /home/yjh/my_claude
export ANTHROPIC_API_KEY="00gcclg9l39y9p01000dhjzolag1q2hk00901kh1"
export ANTHROPIC_BASE_URL="https://api.gpugeek.com"
python3 run_biomnibench_direct.py da-10-1  # 从 da-10-1 开始
```

## 🎯 配置信息

- **模型**: Vendor2/Claude-4.7-opus
- **Judge**: Vendor3/qwen3.5-plus
- **API 端点**: https://api.gpugeek.com
- **Max tokens**: 16000
- **Temperature**: 1.0
- **超时**: 300秒/Judge

## 📊 预期结果

完成后会生成：
- 50 个任务的 trace.md 和 answer.txt
- 50 个 judge_result.json 评分文件
- 1 个 summary JSON 包含所有结果

查看最终总结：
```bash
cat /data/yjh/biomnibench-results/summary_*.json | jq
```

---

**测评启动时间**: 2026-06-08 02:39
**预计完成时间**: 2026-06-08 06:00 - 10:00
