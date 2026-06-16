#!/bin/bash

# 实时监控批量测试进度

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║              方法2 批量测试 - 实时监控                      ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

# 检查批量测试是否在运行
if ! ps aux | grep "run_all_studies.sh" | grep -v grep > /dev/null; then
    echo "❌ 批量测试未运行"
    echo ""
    echo "启动批量测试："
    echo "  nohup ./run_all_studies.sh > batch_test_output.log 2>&1 &"
    exit 1
fi

echo "✅ 批量测试正在运行"
echo ""

# 查找最新的日志文件
LATEST_LOG=$(ls -t batch_test_*.log 2>/dev/null | head -1)

if [ -z "$LATEST_LOG" ]; then
    echo "⚠️  未找到日志文件，等待生成..."
    sleep 5
    LATEST_LOG=$(ls -t batch_test_*.log 2>/dev/null | head -1)
fi

if [ -n "$LATEST_LOG" ]; then
    echo "📋 日志文件: $LATEST_LOG"
    echo ""
fi

# 显示当前状态
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "当前时间: $(date '+%Y-%m-%d %H:%M:%S')"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# 检查当前运行的任务
CURRENT_STUDY=$(ps aux | grep "run_method2_batch.py --study" | grep -v grep | sed 's/.*--study \([0-9]*\).*/\1/')

if [ -n "$CURRENT_STUDY" ]; then
    echo "🔄 当前运行: 母任务 $CURRENT_STUDY"
    
    # 查找当前任务的运行目录
    CURRENT_RUN=$(ls -td output/Bio_runs/${CURRENT_STUDY}_incremental_* 2>/dev/null | head -1)
    
    if [ -n "$CURRENT_RUN" ]; then
        echo "   运行目录: $(basename $CURRENT_RUN)"
        
        # 检查study_state.json
        if [ -f "$CURRENT_RUN/study_state.json" ]; then
            python3 << EOF
import json
try:
    with open('$CURRENT_RUN/study_state.json') as f:
        s = json.load(f)
        print(f"   进度: {s.get('completed_subtasks', 0)}/{s.get('num_subtasks', 0)} 子任务")
        print(f"   通过: {s.get('passed_subtasks', 0)}")
        print(f"   失败: {s.get('failed_subtasks', 0)}")
except:
    pass
EOF
        fi
        
        # 检查当前运行的子任务
        CURRENT_SUBTASK=$(ps aux | grep "bun.*cli.ts --task ${CURRENT_STUDY}_" | grep -v grep | sed "s/.*--task ${CURRENT_STUDY}_\([0-9]*\).*/\1/")
        if [ -n "$CURRENT_SUBTASK" ]; then
            echo "   当前子任务: $CURRENT_SUBTASK"
        fi
    fi
else
    echo "⏸️  等待下一个任务..."
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# 统计已完成的任务
echo "📊 已完成的母任务："
echo ""

STUDIES=("32864625" "34819518" "29713087" "30742119" "28481359" "28985567" "27959731" "28472509" "30867592" "37699004" "33765338" "32437664")

COMPLETED_COUNT=0
PASSED_COUNT=0

for study_id in "${STUDIES[@]}"; do
    LATEST_RUN=$(ls -td output/Bio_runs/${study_id}_incremental_* 2>/dev/null | head -1)
    
    if [ -n "$LATEST_RUN" ] && [ -f "$LATEST_RUN/study_state.json" ]; then
        RESULT=$(python3 << EOF
import json
try:
    with open('$LATEST_RUN/study_state.json') as f:
        s = json.load(f)
        passed = s.get('passed_subtasks', 0)
        total = s.get('num_subtasks', 0)
        completed = s.get('completed_subtasks', 0)
        if completed == total:
            print(f"$study_id|{passed}|{total}|DONE")
        else:
            print(f"$study_id|{passed}|{total}|RUNNING")
except:
    pass
EOF
)
        if [ -n "$RESULT" ]; then
            STUDY=$(echo "$RESULT" | cut -d'|' -f1)
            PASSED=$(echo "$RESULT" | cut -d'|' -f2)
            TOTAL=$(echo "$RESULT" | cut -d'|' -f3)
            STATUS=$(echo "$RESULT" | cut -d'|' -f4)
            
            if [ "$STATUS" = "DONE" ]; then
                COMPLETED_COUNT=$((COMPLETED_COUNT + 1))
                RATE=$(python3 -c "print(f'{$PASSED/$TOTAL*100:.1f}')")
                
                if [ "$PASSED" = "$TOTAL" ]; then
                    echo "  ✅ $STUDY: $PASSED/$TOTAL (100%)"
                    PASSED_COUNT=$((PASSED_COUNT + 1))
                else
                    echo "  ⚠️  $STUDY: $PASSED/$TOTAL ($RATE%)"
                fi
            elif [ "$STATUS" = "RUNNING" ]; then
                echo "  🔄 $STUDY: $PASSED/$TOTAL (运行中...)"
            fi
        fi
    fi
done

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "进度: $COMPLETED_COUNT/12 已完成，$PASSED_COUNT 全部通过"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# 显示最近的日志
if [ -n "$LATEST_LOG" ]; then
    echo "📝 最近的日志（最后20行）："
    echo ""
    tail -20 "$LATEST_LOG"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "监控命令："
echo "  watch -n 30 ./monitor_batch_test.sh  # 每30秒刷新"
echo "  tail -f $LATEST_LOG                  # 实时查看日志"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
