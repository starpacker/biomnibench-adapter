#!/usr/bin/env python3
"""
统计所有combined任务的信息
"""
from pathlib import Path
import json

TASKS_DIR = Path("/home/yjh/my_claude/tasks")

def main():
    print("=" * 70)
    print("BioDSBench Combined Tasks 统计")
    print("=" * 70)
    print()
    
    combined_tasks = sorted(TASKS_DIR.glob("*_combined"))
    
    total_subtasks = 0
    
    print(f"{'任务ID':<25} {'子任务数':<10} {'状态'}")
    print("-" * 70)
    
    for task_dir in combined_tasks:
        task_name = task_dir.name
        
        # 读取README获取子任务数
        readme_file = task_dir / "README.md"
        subtask_count = 0
        if readme_file.exists():
            content = readme_file.read_text()
            # 统计"- 25303977_X"这样的行数
            subtask_count = content.count(f"- {task_name.replace('_combined', '_')}")
        
        # 检查关键文件
        has_manifest = (task_dir / "task_manifest.json").exists()
        has_judge = (task_dir / "evaluation" / "judge.py").exists()
        has_test = (task_dir / "evaluation" / "test_cases.py").exists()
        
        status = "✅" if (has_manifest and has_judge and has_test) else "❌"
        
        print(f"{task_name:<25} {subtask_count:<10} {status}")
        total_subtasks += subtask_count
    
    print("-" * 70)
    print(f"{'总计':<25} {total_subtasks:<10}")
    print()
    print(f"Combined任务总数: {len(combined_tasks)}")
    print(f"子任务总数: {total_subtasks}")
    print()
    
    # 检查任务列表文件
    task_list_file = TASKS_DIR.parent / "combined_tasks_list.txt"
    if task_list_file.exists():
        print(f"任务列表文件: {task_list_file}")
        with open(task_list_file) as f:
            tasks_in_list = [line.strip() for line in f if line.strip()]
        print(f"列表中的任务数: {len(tasks_in_list)}")
    
    print()
    print("=" * 70)
    print("快速开始:")
    print("  单个任务: ./run_biodsbench.sh 25303977_combined")
    print("  批量运行: ./run_all_combined_tasks.sh")
    print("  查看文档: cat COMBINED_TASKS_README.md")
    print("=" * 70)

if __name__ == "__main__":
    main()
