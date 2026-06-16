#!/bin/bash
#
# 批量运行所有combined任务的快速启动脚本
# 用法: ./run_all_combined_tasks.sh [start_index]
#

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 所有combined任务列表
TASKS=(
    "25303977_combined"
    "27959731_combined"
    "28472509_combined"
    "28481359_combined"
    "28985567_combined"
    "29713087_combined"
    "30742119_combined"
    "30867592_combined"
    "32437664_combined"
    "32864625_combined"
    "33765338_combined"
    "34819518_combined"
    "37699004_combined"
)

# 起始索引（从0开始）
START_INDEX=${1:-0}

# 日志目录
LOG_DIR="./logs/batch_runs"
mkdir -p "$LOG_DIR"

# 时间戳
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BATCH_LOG="$LOG_DIR/batch_run_${TIMESTAMP}.log"

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}批量运行Combined任务${NC}"
echo -e "${BLUE}========================================${NC}"
echo -e "总任务数: ${#TASKS[@]}"
echo -e "起始索引: $START_INDEX"
echo -e "批次日志: $BATCH_LOG"
echo -e "${BLUE}========================================${NC}\n"

# 记录开始时间
BATCH_START_TIME=$(date +%s)

# 运行任务
for i in "${!TASKS[@]}"; do
    # 跳过起始索引之前的任务
    if [ $i -lt $START_INDEX ]; then
        continue
    fi
    
    TASK="${TASKS[$i]}"
    TASK_NUM=$((i + 1))
    
    echo -e "\n${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${GREEN}[${TASK_NUM}/${#TASKS[@]}] 开始运行: ${TASK}${NC}"
    echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    
    # 记录任务开始时间
    TASK_START_TIME=$(date +%s)
    
    # 运行任务
    TASK_LOG="$LOG_DIR/${TASK}_${TIMESTAMP}.log"
    
    if ./run_biodsbench.sh "$TASK" 2>&1 | tee "$TASK_LOG"; then
        # 任务成功
        TASK_END_TIME=$(date +%s)
        TASK_DURATION=$((TASK_END_TIME - TASK_START_TIME))
        
        echo -e "\n${GREEN}✅ [${TASK_NUM}/${#TASKS[@]}] ${TASK} 完成${NC}"
        echo -e "${GREEN}   用时: ${TASK_DURATION}秒${NC}"
        
        # 记录到批次日志
        echo "[$(date)] ✅ ${TASK} - 成功 (${TASK_DURATION}s)" >> "$BATCH_LOG"
    else
        # 任务失败
        TASK_END_TIME=$(date +%s)
        TASK_DURATION=$((TASK_END_TIME - TASK_START_TIME))
        
        echo -e "\n${RED}❌ [${TASK_NUM}/${#TASKS[@]}] ${TASK} 失败${NC}"
        echo -e "${RED}   用时: ${TASK_DURATION}秒${NC}"
        echo -e "${RED}   日志: ${TASK_LOG}${NC}"
        
        # 记录到批次日志
        echo "[$(date)] ❌ ${TASK} - 失败 (${TASK_DURATION}s)" >> "$BATCH_LOG"
        
        # 询问是否继续
        echo -e "\n${YELLOW}任务失败，是否继续下一个任务？ (y/n)${NC}"
        read -r CONTINUE
        if [[ ! "$CONTINUE" =~ ^[Yy]$ ]]; then
            echo -e "${RED}用户中止批量运行${NC}"
            exit 1
        fi
    fi
    
    echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"
    
    # 短暂休息，避免系统过载
    sleep 2
done

# 计算总用时
BATCH_END_TIME=$(date +%s)
BATCH_DURATION=$((BATCH_END_TIME - BATCH_START_TIME))
BATCH_HOURS=$((BATCH_DURATION / 3600))
BATCH_MINUTES=$(((BATCH_DURATION % 3600) / 60))
BATCH_SECONDS=$((BATCH_DURATION % 60))

echo -e "\n${BLUE}========================================${NC}"
echo -e "${GREEN}批量运行完成！${NC}"
echo -e "${BLUE}========================================${NC}"
echo -e "总用时: ${BATCH_HOURS}小时 ${BATCH_MINUTES}分钟 ${BATCH_SECONDS}秒"
echo -e "批次日志: $BATCH_LOG"
echo -e "${BLUE}========================================${NC}\n"

# 显示汇总
echo -e "${BLUE}任务汇总:${NC}"
grep "✅" "$BATCH_LOG" | wc -l | xargs echo "  成功:"
grep "❌" "$BATCH_LOG" | wc -l | xargs echo "  失败:"
