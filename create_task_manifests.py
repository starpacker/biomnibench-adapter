#!/usr/bin/env python3
"""为子任务生成task manifest"""

import json
from pathlib import Path

def create_manifest(task_id: str):
    """创建task manifest"""
    manifest = {
        "version": 1,
        "task_id": task_id,
        "public_bundle": [
            "README.md",
            "queries.md",
            "cot_instructions.md",
            "requirements.txt",
            "workdir",
            "envs"
        ],
        "private_judge_bundle": [
            "evaluation"
        ],
        "entrypoints": {
            "judge": "evaluation/test_cases.py",
            "environment": "envs/env_manifest.json"
        },
        "submission": {
            "output_dir": "outputs"
        }
    }
    return manifest

def main():
    # 为25303977的所有子任务创建manifest
    study_id = "25303977"
    
    for i in range(8):
        task_id = f"{study_id}_{i}"
        task_dir = Path(f"tasks/{task_id}")
        
        if not task_dir.exists():
            print(f"⚠️  任务目录不存在: {task_dir}")
            continue
        
        # 备份原始task.json
        original_file = task_dir / "task.json"
        backup_file = task_dir / "task_original.json"
        
        if original_file.exists() and not backup_file.exists():
            # 备份原始文件
            with open(original_file, 'r') as f:
                original_content = f.read()
            with open(backup_file, 'w') as f:
                f.write(original_content)
            print(f"✓ 备份 {task_id}/task.json -> task_original.json")
        
        # 创建新的manifest
        manifest = create_manifest(task_id)
        with open(original_file, 'w') as f:
            json.dump(manifest, f, indent=2)
        print(f"✓ 创建 {task_id}/task.json (manifest)")
        
        # 确保符号链接存在
        manifest_link = task_dir / "task_manifest.json"
        if not manifest_link.exists():
            manifest_link.symlink_to("task.json")
            print(f"✓ 创建 {task_id}/task_manifest.json -> task.json")

if __name__ == "__main__":
    main()
