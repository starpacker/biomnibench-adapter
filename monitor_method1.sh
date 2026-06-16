#!/bin/bash
# 监控方法1的执行进度

cd /home/yjh/my_claude

echo "========================================"
echo "方法1批量执行进度监控"
echo "========================================"
echo ""
echo "当前时间: $(date '+%Y-%m-%d %H:%M:%S')"
echo ""

# 检查进程
echo "1. 进程状态:"
if ps aux | grep 590037 | grep -v grep > /dev/null; then
    echo "   ✅ 批量任务正在运行 (PID: 590037)"
else
    echo "   ❌ 批量任务已停止"
fi
echo ""

# 统计完成情况
COMPLETED=$(ls -d output/Bio_runs/*_combined_* 2>/dev/null | xargs -I {} basename {} | awk -F'_combined' '{print $1}' | sort -u | wc -l)
TOTAL=13
REMAINING=$((TOTAL - COMPLETED))

echo "2. 任务完成情况:"
echo "   总任务数: $TOTAL"
echo "   已完成: $COMPLETED"
echo "   剩余: $REMAINING"
echo "   进度: $(echo "scale=1; $COMPLETED * 100 / $TOTAL" | bc)%"
echo ""

# 已完成的任务
echo "3. 已完成的任务:"
ls -d output/Bio_runs/*_combined_* 2>/dev/null | xargs -I {} basename {} | awk -F'_combined' '{print $1}' | sort -u | nl | sed 's/^/   /'
echo ""

# 还需完成的任务
echo "4. 还需完成的任务:"
comm -23 \
  <(echo -e "25303977\n27959731\n28472509\n28481359\n28985567\n29713087\n30742119\n30867592\n32437664\n32864625\n33765338\n34819518\n37699004" | sort) \
  <(ls -d output/Bio_runs/*_combined_* 2>/dev/null | xargs -I {} basename {} | awk -F'_combined' '{print $1}' | sort -u) \
  | nl | sed 's/^/   /'
echo ""

# 最近完成的任务
echo "5. 最近完成的3个任务:"
ls -td output/Bio_runs/*_combined_* 2>/dev/null | head -3 | while read dir; do
    task=$(basename "$dir" | awk -F'_combined' '{print $1}')
    time=$(basename "$dir" | awk -F'_' '{print $NF}')
    echo "   - $task (完成时间: $time)"
done
echo ""

# 预计完成时间
if [ $REMAINING -gt 0 ]; then
    echo "6. 预计完成时间:"
    echo "   剩余 $REMAINING 个任务"
    echo "   预计: ~16:40 - 17:00"
else
    echo "6. 状态:"
    echo "   ✅ 所有任务已完成!"
fi
echo ""

echo "========================================"
echo "提示: 使用 watch -n 60 ./monitor_method1.sh 实时监控"
echo "========================================"
