#!/usr/bin/env python3
"""
重新运行有环境问题的母任务
使用修复后的评测器
"""
import sys
import json
from pathlib import Path
from datetime import datetime
from get_all_subtasks import STUDY_CONFIGS
from study_task_executor import StudyTaskExecutor

def rerun_specific_studies(study_ids: list, max_rounds_per_subtask: int = 3):
    """
    重新运行指定的母任务

    Args:
        study_ids: 要运行的母任务ID列表
        max_rounds_per_subtask: 每个子任务最多重试次数
    """
    print(f"\n{'='*70}")
    print(f"重新运行指定母任务（使用修复后的评测器）")
    print(f"母任务列表: {study_ids}")
    print(f"每个子任务最大重试: {max_rounds_per_subtask}")
    print(f"{'='*70}\n")

    # 统计信息
    stats = {
        "total_studies": len(study_ids),
        "completed_studies": 0,
        "passed_studies": 0,
        "failed_studies": 0,
        "total_subtasks": 0,
        "passed_subtasks": 0,
        "failed_subtasks": 0,
        "start_time": datetime.now().isoformat(),
        "results": []
    }

    # 执行每个母任务
    for study_id in study_ids:
        # 查找该母任务的配置
        config = None
        for sid, num_subtasks in STUDY_CONFIGS:
            if sid == study_id:
                config = (sid, num_subtasks)
                break

        if not config:
            print(f"❌ 未找到母任务 {study_id} 的配置")
            continue

        study_id, num_subtasks = config
        stats["total_subtasks"] += num_subtasks

        print(f"\n{'='*70}")
        print(f"执行母任务: {study_id}")
        print(f"子任务数: {num_subtasks}")
        print(f"{'='*70}\n")

        # 创建执行器
        executor = StudyTaskExecutor(
            study_id=study_id,
            num_subtasks=num_subtasks,
            max_rounds_per_subtask=max_rounds_per_subtask
        )

        # 执行
        try:
            result = executor.execute()

            stats["completed_studies"] += 1
            stats["passed_subtasks"] += result.get("passed_subtasks", 0)
            stats["failed_subtasks"] += result.get("failed_subtasks", 0)

            if result.get("status") == "passed":
                stats["passed_studies"] += 1
                print(f"\n✅ 母任务 {study_id} 全部通过!")
            else:
                stats["failed_studies"] += 1
                print(f"\n❌ 母任务 {study_id} 失败")

            stats["results"].append({
                "study_id": study_id,
                "num_subtasks": num_subtasks,
                "status": result.get("status"),
                "passed_subtasks": result.get("passed_subtasks", 0),
                "failed_subtasks": result.get("failed_subtasks", 0),
                "run_dir": result.get("run_dir")
            })

        except Exception as e:
            print(f"\n❌ 母任务 {study_id} 执行异常: {e}")
            stats["failed_studies"] += 1
            stats["results"].append({
                "study_id": study_id,
                "num_subtasks": num_subtasks,
                "status": "error",
                "error": str(e)
            })

    # 输出最终统计
    stats["end_time"] = datetime.now().isoformat()

    print(f"\n{'='*70}")
    print(f"重新运行完成!")
    print(f"{'='*70}")
    print(f"总母任务数: {stats['total_studies']}")
    print(f"完成: {stats['completed_studies']}")
    print(f"通过: {stats['passed_studies']}")
    print(f"失败: {stats['failed_studies']}")
    print(f"总子任务数: {stats['total_subtasks']}")
    print(f"通过子任务: {stats['passed_subtasks']}")
    print(f"失败子任务: {stats['failed_subtasks']}")
    print(f"{'='*70}\n")

    # 保存统计信息
    stats_file = Path("rerun_stats.json")
    with open(stats_file, 'w') as f:
        json.dump(stats, f, indent=2)
    print(f"统计信息已保存: {stats_file}")

    return stats


if __name__ == "__main__":
    # 要重新运行的母任务
    study_ids_to_rerun = [
        "29713087",  # 子任务2有目录查找问题
        "28472509",  # 子任务4有代码执行问题
    ]

    # 可以从命令行参数指定
    if len(sys.argv) > 1:
        study_ids_to_rerun = sys.argv[1:]

    stats = rerun_specific_studies(study_ids_to_rerun, max_rounds_per_subtask=3)

    # 返回退出码
    sys.exit(0 if stats["failed_studies"] == 0 else 1)
