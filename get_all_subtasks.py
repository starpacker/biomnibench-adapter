#!/usr/bin/env python3
"""
获取所有118个子任务的列表，按照母任务分组
"""
import os
from pathlib import Path

# 13个母任务的study_id和子任务数量
STUDY_CONFIGS = [
    ("25303977", 8),
    ("27959731", 10),
    ("28472509", 10),
    ("28481359", 9),
    ("28985567", 9),
    ("29713087", 7),
    ("30742119", 8),
    ("30867592", 10),
    ("32437664", 13),
    ("32864625", 6),
    ("33765338", 12),
    ("34819518", 6),
    ("37699004", 10),
]

def get_all_subtasks():
    """
    返回所有118个子任务的列表
    格式: [(study_id, task_index, task_id), ...]
    例如: [("25303977", 0, "25303977_0"), ...]
    """
    subtasks = []
    for study_id, count in STUDY_CONFIGS:
        for i in range(count):
            task_id = f"{study_id}_{i}"
            subtasks.append((study_id, i, task_id))
    return subtasks

def get_subtasks_by_study(study_id):
    """获取某个母任务的所有子任务"""
    for sid, count in STUDY_CONFIGS:
        if sid == study_id:
            return [(study_id, i, f"{study_id}_{i}") for i in range(count)]
    return []

def verify_subtasks_exist(tasks_dir="tasks"):
    """验证所有子任务目录是否存在"""
    tasks_path = Path(tasks_dir)
    missing = []
    
    for study_id, idx, task_id in get_all_subtasks():
        task_path = tasks_path / task_id
        if not task_path.exists():
            missing.append(task_id)
        else:
            # 检查evaluation目录
            eval_path = task_path / "evaluation"
            if not eval_path.exists():
                missing.append(f"{task_id}/evaluation")
    
    return missing

if __name__ == "__main__":
    subtasks = get_all_subtasks()
    print(f"总共 {len(subtasks)} 个子任务")
    
    # 按母任务分组显示
    for study_id, count in STUDY_CONFIGS:
        tasks = get_subtasks_by_study(study_id)
        print(f"\n{study_id}: {len(tasks)} 个子任务")
        for _, idx, task_id in tasks[:3]:
            print(f"  - {task_id}")
        if len(tasks) > 3:
            print(f"  ... 还有 {len(tasks)-3} 个")
    
    # 验证
    print("\n验证子任务目录...")
    missing = verify_subtasks_exist()
    if missing:
        print(f"❌ 缺失 {len(missing)} 个:")
        for m in missing[:10]:
            print(f"  - {m}")
    else:
        print("✅ 所有子任务目录都存在")
