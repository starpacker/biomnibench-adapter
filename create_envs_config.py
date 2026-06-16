#!/usr/bin/env python3
"""为子任务1-7创建envs配置"""

import json
import shutil
from pathlib import Path

def create_envs_for_subtask(task_id: str):
    """为指定子任务创建envs配置"""
    task_dir = Path(f"tasks/{task_id}")
    
    if not task_dir.exists():
        print(f"⚠️  任务目录不存在: {task_dir}")
        return False
    
    # 源envs目录（子任务0）
    source_envs = Path("tasks/25303977_0/envs")
    if not source_envs.exists():
        print(f"⚠️  源envs目录不存在: {source_envs}")
        return False
    
    # 目标envs目录
    target_envs = task_dir / "envs"
    
    # 如果已存在，跳过
    if target_envs.exists():
        print(f"✓ {task_id}/envs 已存在，跳过")
        return True
    
    # 复制整个envs目录
    shutil.copytree(source_envs, target_envs, symlinks=True)
    print(f"✓ 创建 {task_id}/envs (从25303977_0复制)")
    
    return True

def main():
    study_id = "25303977"
    
    print("=" * 60)
    print("为子任务1-7创建envs配置")
    print("=" * 60)
    print()
    
    success_count = 0
    for i in range(1, 8):
        task_id = f"{study_id}_{i}"
        if create_envs_for_subtask(task_id):
            success_count += 1
    
    print()
    print("=" * 60)
    print(f"完成: {success_count}/7 个子任务")
    print("=" * 60)

if __name__ == "__main__":
    main()
