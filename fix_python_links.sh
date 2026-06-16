#!/bin/bash
# 修复所有任务的 Python 环境链接

TASKS_DIR="/home/yjh/BioDSBench-imaging101-format/tasks"
CORRECT_PYTHON=$(which python3)

echo "修复 Python 链接..."
echo "正确的 Python 路径: $CORRECT_PYTHON"
echo ""

count=0
for task_dir in $TASKS_DIR/*/; do
    venv_python="$task_dir/envs/runtime/.venv/bin/python"

    if [ -L "$venv_python" ]; then
        # 删除旧链接
        rm "$venv_python"
        # 创建新链接
        ln -s "$CORRECT_PYTHON" "$venv_python"
        count=$((count + 1))
    fi
done

echo "修复完成! 共修复 $count 个任务的 Python 链接"
