#!/usr/bin/env python3
"""Generate task_manifest.json for BioDSBench tasks to be compatible with the evaluation harness."""

import json
import sys
from pathlib import Path

def create_task_manifest(task_dir: Path, task_id: str):
    """Create a task_manifest.json file for a BioDSBench task."""
    
    task_json_path = task_dir / "task.json"
    if not task_json_path.exists():
        print(f"Error: task.json not found in {task_dir}")
        return False
    
    # Read the original task.json
    with open(task_json_path, 'r') as f:
        task_data = json.load(f)
    
    # Create the manifest structure expected by the evaluation harness
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
    
    # Write the manifest
    manifest_path = task_dir / "task_manifest.json"
    with open(manifest_path, 'w') as f:
        json.dump(manifest, f, indent=2)
    
    print(f"Created task_manifest.json for task: {task_id}")
    return True

if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python generate_task_manifest.py <task_id>")
        sys.exit(1)
    
    task_id = sys.argv[1]
    task_dir = Path(f"/home/yjh/BioDSBench-imaging101-format/tasks/{task_id}")
    
    if not task_dir.exists():
        print(f"Error: Task directory not found: {task_dir}")
        sys.exit(1)
    
    success = create_task_manifest(task_dir, task_id)
    sys.exit(0 if success else 1)
