#!/usr/bin/env python3
"""监控方法2的执行进度"""

import json
import sys
from pathlib import Path
from datetime import datetime

def monitor_progress():
    # 找到最新的运行目录
    runs_dir = Path("output/Bio_runs")
    incremental_runs = sorted(runs_dir.glob("25303977_incremental_*"), reverse=True)
    
    if not incremental_runs:
        print("没有找到运行记录")
        return
    
    latest_run = incremental_runs[0]
    state_file = latest_run / "study_state.json"
    
    if not state_file.exists():
        print(f"状态文件不存在: {state_file}")
        return
    
    with open(state_file, "r") as f:
        state = json.load(f)
    
    print(f"\n{'='*70}")
    print(f"方法2执行进度监控")
    print(f"{'='*70}\n")
    
    print(f"运行目录: {latest_run.name}")
    print(f"母任务ID: {state['study_id']}")
    print(f"总子任务数: {state['num_subtasks']}")
    print(f"状态: {state['status']}")
    print(f"开始时间: {state['start_time']}")
    
    print(f"\n进度: {state['completed_subtasks']}/{state['num_subtasks']}")
    print(f"通过: {state['passed_subtasks']}")
    print(f"失败: {state['failed_subtasks']}")
    
    if state['completed_subtasks'] > 0:
        success_rate = state['passed_subtasks'] / state['completed_subtasks'] * 100
        print(f"当前成功率: {success_rate:.1f}%")
    
    print(f"\n{'='*70}")
    print("子任务详情:")
    print(f"{'='*70}\n")
    
    for subtask in state['subtasks']:
        task_id = subtask['task_id']
        status = subtask['status']
        rounds = len(subtask['rounds'])
        
        status_icon = "✅" if status == "passed" else "❌"
        print(f"{status_icon} {task_id}: {status} (尝试了 {rounds} 轮)")
        
        if subtask['rounds']:
            last_round = subtask['rounds'][-1]
            if last_round.get('error'):
                error_preview = last_round['error'][:100].replace('\n', ' ')
                print(f"   最后错误: {error_preview}...")
    
    print(f"\n{'='*70}\n")

if __name__ == "__main__":
    monitor_progress()
