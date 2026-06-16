#!/usr/bin/env python3
"""
BioMniBench 数据整理脚本
按照 conventional_ptychography 的结构组织所有任务
"""
import shutil
import json
from pathlib import Path
from typing import Dict, List

# 源目录和目标目录
SOURCE_DIR = Path("/data/yjh/biomnibench-da")
TARGET_DIR = Path("/data/yjh/biomnibench-organized")

# 参考结构：conventional_ptychography
REFERENCE_TASK = SOURCE_DIR / "conventional_ptychography"

def get_standard_structure():
    """获取标准的目录结构"""
    return [
        "envs",
        "evaluation",
        "std_code",
        "visible_data"
    ]

def get_standard_files():
    """获取标准的文件列表"""
    return [
        "README.md",
        "output_schema.json",
        "requirements.txt",
        "task_manifest.json"
    ]

def organize_task(task_name: str, source_path: Path, target_path: Path) -> Dict:
    """
    整理单个任务

    Args:
        task_name: 任务名称
        source_path: 源路径
        target_path: 目标路径

    Returns:
        整理结果字典
    """
    result = {
        "task_name": task_name,
        "status": "pending",
        "source": str(source_path),
        "target": str(target_path),
        "issues": []
    }

    try:
        # 创建目标目录
        target_path.mkdir(parents=True, exist_ok=True)

        # 检查源目录结构
        if not source_path.exists():
            result["status"] = "error"
            result["issues"].append(f"Source directory does not exist: {source_path}")
            return result

        # 根据源目录结构进行组织
        # 情况1: 已经是标准结构（如 conventional_ptychography）
        if (source_path / "evaluation").exists() and (source_path / "task_manifest.json").exists():
            # 直接复制
            for item in source_path.iterdir():
                if item.is_dir():
                    shutil.copytree(item, target_path / item.name, dirs_exist_ok=True)
                else:
                    shutil.copy2(item, target_path / item.name)
            result["status"] = "copied"

        # 情况2: 新格式（如 da-1-3）
        elif (source_path / "instruction.md").exists() and (source_path / "task.toml").exists():
            # 创建标准目录结构
            (target_path / "envs").mkdir(exist_ok=True)
            (target_path / "evaluation").mkdir(exist_ok=True)
            (target_path / "visible_data").mkdir(exist_ok=True)

            # 复制 environment -> envs
            if (source_path / "environment").exists():
                shutil.copytree(source_path / "environment", target_path / "envs", dirs_exist_ok=True)

            # 复制 tests -> evaluation
            if (source_path / "tests").exists():
                shutil.copytree(source_path / "tests", target_path / "evaluation", dirs_exist_ok=True)

            # 复制 instruction.md -> README.md
            if (source_path / "instruction.md").exists():
                shutil.copy2(source_path / "instruction.md", target_path / "README.md")

            # 复制 task.toml -> task_manifest.json (转换格式)
            if (source_path / "task.toml").exists():
                # 简单复制，后续可以添加格式转换
                shutil.copy2(source_path / "task.toml", target_path / "task.toml")

                # 创建一个基本的 task_manifest.json
                manifest = {
                    "task_id": task_name,
                    "source_format": "toml",
                    "original_file": "task.toml"
                }
                with open(target_path / "task_manifest.json", "w") as f:
                    json.dump(manifest, f, indent=2)

            result["status"] = "converted"

        else:
            result["status"] = "unknown"
            result["issues"].append(f"Unknown directory structure")

    except Exception as e:
        result["status"] = "error"
        result["issues"].append(str(e))

    return result

def organize_all_tasks():
    """整理所有任务"""
    print(f"{'='*70}")
    print(f"BioMniBench 数据整理")
    print(f"{'='*70}")
    print(f"源目录: {SOURCE_DIR}")
    print(f"目标目录: {TARGET_DIR}")
    print()

    # 创建目标目录
    TARGET_DIR.mkdir(parents=True, exist_ok=True)

    # 获取所有任务
    tasks = []
    for item in SOURCE_DIR.iterdir():
        if item.is_dir() and not item.name.startswith('.'):
            tasks.append(item)

    print(f"找到 {len(tasks)} 个任务")
    print()

    # 整理每个任务
    results = []
    for idx, task_path in enumerate(sorted(tasks), 1):
        task_name = task_path.name
        target_path = TARGET_DIR / task_name

        print(f"[{idx}/{len(tasks)}] 整理任务: {task_name}")

        result = organize_task(task_name, task_path, target_path)
        results.append(result)

        if result["status"] == "error":
            print(f"  ❌ 失败: {', '.join(result['issues'])}")
        elif result["status"] == "copied":
            print(f"  ✅ 已复制（标准格式）")
        elif result["status"] == "converted":
            print(f"  ✅ 已转换（新格式 -> 标准格式）")
        elif result["status"] == "unknown":
            print(f"  ⚠️  未知格式")

        print()

    # 保存整理结果
    summary_file = TARGET_DIR / "organization_summary.json"
    with open(summary_file, "w") as f:
        json.dump({
            "total_tasks": len(results),
            "copied": sum(1 for r in results if r["status"] == "copied"),
            "converted": sum(1 for r in results if r["status"] == "converted"),
            "errors": sum(1 for r in results if r["status"] == "error"),
            "unknown": sum(1 for r in results if r["status"] == "unknown"),
            "tasks": results
        }, f, indent=2)

    # 打印总结
    print(f"{'='*70}")
    print(f"整理完成!")
    print(f"{'='*70}")
    print(f"总任务数: {len(results)}")
    print(f"已复制（标准格式）: {sum(1 for r in results if r['status'] == 'copied')}")
    print(f"已转换（新格式）: {sum(1 for r in results if r['status'] == 'converted')}")
    print(f"错误: {sum(1 for r in results if r['status'] == 'error')}")
    print(f"未知: {sum(1 for r in results if r['status'] == 'unknown')}")
    print()
    print(f"结果保存至: {summary_file}")
    print(f"{'='*70}")

if __name__ == "__main__":
    organize_all_tasks()
