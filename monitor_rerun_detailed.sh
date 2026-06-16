#!/bin/bash
# 持续监控29713087和28472509的运行进度

echo "=========================================="
echo "监控重新运行进度"
echo "时间: $(date)"
echo "=========================================="
echo ""

# 29713087
echo "【任务1】29713087 (7个子任务)"
echo "----------------------------------------"
run_dir_29713087=$(ls -td /home/yjh/my_claude/output/Bio_runs/29713087_incremental_* 2>/dev/null | head -1)
if [ -n "$run_dir_29713087" ]; then
    state_file="$run_dir_29713087/study_state.json"
    if [ -f "$state_file" ]; then
        python3 -c "
import json
with open('$state_file') as f:
    state = json.load(f)
    status = state.get('status', 'unknown')
    completed = state.get('completed_subtasks', 0)
    passed = state.get('passed_subtasks', 0)
    failed = state.get('failed_subtasks', 0)
    total = state.get('num_subtasks', 0)

    status_icon = '✅' if status == 'passed' else '🔄' if status == 'running' else '❌'
    print(f'{status_icon} 状态: {status}')
    print(f'进度: {completed}/{total} 完成')
    print(f'通过: {passed}, 失败: {failed}')

    if state.get('subtasks'):
        print()
        print('子任务详情:')
        for subtask in state['subtasks']:
            idx = subtask['subtask_index']
            st = subtask['status']
            rounds = len(subtask.get('rounds', []))
            icon = '✅' if st == 'passed' else '❌' if st == 'failed' else '🔄'
            print(f'  {icon} 子任务{idx}: {st} ({rounds}轮)')
"
    else
        echo "状态文件不存在"
    fi
    echo "运行目录: $run_dir_29713087"
else
    echo "未找到运行目录"
fi

echo ""
echo "【任务2】28472509 (10个子任务)"
echo "----------------------------------------"
run_dir_28472509=$(ls -td /home/yjh/my_claude/output/Bio_runs/28472509_incremental_* 2>/dev/null | head -1)
if [ -n "$run_dir_28472509" ]; then
    state_file="$run_dir_28472509/study_state.json"
    if [ -f "$state_file" ]; then
        python3 -c "
import json
with open('$state_file') as f:
    state = json.load(f)
    status = state.get('status', 'unknown')
    completed = state.get('completed_subtasks', 0)
    passed = state.get('passed_subtasks', 0)
    failed = state.get('failed_subtasks', 0)
    total = state.get('num_subtasks', 0)

    status_icon = '✅' if status == 'passed' else '🔄' if status == 'running' else '❌'
    print(f'{status_icon} 状态: {status}')
    print(f'进度: {completed}/{total} 完成')
    print(f'通过: {passed}, 失败: {failed}')

    if state.get('subtasks'):
        print()
        print('子任务详情:')
        for subtask in state['subtasks']:
            idx = subtask['subtask_index']
            st = subtask['status']
            rounds = len(subtask.get('rounds', []))
            icon = '✅' if st == 'passed' else '❌' if st == 'failed' else '🔄'
            print(f'  {icon} 子任务{idx}: {st} ({rounds}轮)')
"
    else
        echo "状态文件不存在"
    fi
    echo "运行目录: $run_dir_28472509"
else
    echo "⏸️ 尚未启动"
fi

echo ""
echo "=========================================="
echo "提示: 运行 'watch -n 30 bash monitor_rerun_detailed.sh' 自动刷新"
echo "=========================================="
