#!/bin/bash
# 测试单个 BioMniBench 任务

if [ -z "$1" ]; then
    echo "用法: $0 <task_name>"
    echo ""
    echo "示例:"
    echo "  $0 da-1-3"
    echo "  $0 conventional_ptychography"
    echo ""
    echo "可用任务列表:"
    ls /data/yjh/biomnibench-organized/ | grep -E "^(da-|conventional)"
    exit 1
fi

TASK_NAME=$1
TASK_DIR="/data/yjh/biomnibench-organized/$TASK_NAME"

if [ ! -d "$TASK_DIR" ]; then
    echo "错误: 任务目录不存在: $TASK_DIR"
    exit 1
fi

echo "=========================================="
echo "测试单个任务: $TASK_NAME"
echo "=========================================="

export PATH="/home/yjh/.conda/envs/ragas/bin:$PATH"
export ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-00gcclg9l39y9p01000dhjzolag1q2hk00901kh1}"

cd /home/yjh/my_claude

# 临时修改脚本只运行这一个任务
python3 -c "
import sys
from pathlib import Path
sys.path.insert(0, str(Path('/home/yjh/imaging-101')))

from test_biomnibench_tasks import run_single_task

task_name = '$TASK_NAME'
task_dir = Path('$TASK_DIR')
output_dir = Path('/data/yjh/biomnibench-results')

result = run_single_task(task_name, task_dir, output_dir)

print('\n========================================')
print('结果:', '✅ 通过' if result.get('passed') else '❌ 失败')
print('得分:', result.get('score', 0.0))
if result.get('error'):
    print('错误:', result['error'])
print('========================================')
"

echo ""
echo "查看详细结果:"
echo "  ls -la /data/yjh/biomnibench-results/$TASK_NAME/"
