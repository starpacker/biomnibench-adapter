#!/usr/bin/env python3
"""
批量执行所有13个母任务（方法2：增量执行）
每个母任务内部的子任务增量执行、上下文累积
母任务之间相互独立
"""
import sys
import json
from pathlib import Path
from datetime import datetime
from get_all_subtasks import STUDY_CONFIGS
from study_task_executor import StudyTaskExecutor

def run_all_studies(start_index: int = 0, max_rounds_per_subtask: int = 3):
    """
    执行所有13个母任务
    
    Args:
        start_index: 从第几个母任务开始（用于断点续传）
        max_rounds_per_subtask: 每个子任务最多重试次数
    """
    total = len(STUDY_CONFIGS)
    
    print(f"\n{'='*70}")
    print(f"方法2：增量执行 - 批量运行所有母任务")
    print(f"母任务数: {total}")
    print(f"开始索引: {start_index}")
    print(f"每个子任务最大重试: {max_rounds_per_subtask}")
    print(f"{'='*70}\n")
    
    # 统计信息
    stats = {
        "total_studies": total,
        "completed_studies": 0,
        "passed_studies": 0,
        "failed_studies": 0,
        "skipped_studies": start_index,
        "total_subtasks": sum(count for _, count in STUDY_CONFIGS),
        "passed_subtasks": 0,
        "failed_subtasks": 0,
        "start_time": datetime.now().isoformat(),
        "results": []
    }
    
    # 执行每个母任务
    for idx, (study_id, num_subtasks) in enumerate(STUDY_CONFIGS):
        if idx < start_index:
            continue
        
        print(f"\n{'='*70}")
        print(f"进度: [{idx+1}/{total}] - 母任务 {study_id}")
        print(f"子任务数: {num_subtasks}")
        print(f"{'='*70}")
        
        try:
            # 执行母任务
            executor = StudyTaskExecutor(
                study_id=study_id,
                num_subtasks=num_subtasks,
                max_rounds_per_subtask=max_rounds_per_subtask
            )
            result = executor.execute()
            
            # 记录结果
            stats["completed_studies"] += 1
            stats["passed_subtasks"] += result["passed_subtasks"]
            stats["failed_subtasks"] += result["failed_subtasks"]
            
            if result["status"] == "passed":
                stats["passed_studies"] += 1
                print(f"✅ 母任务 {study_id} 全部通过")
            else:
                stats["failed_studies"] += 1
                print(f"❌ 母任务 {study_id} 有失败")
            
            stats["results"].append({
                "study_id": study_id,
                "status": result["status"],
                "passed_subtasks": result["passed_subtasks"],
                "failed_subtasks": result["failed_subtasks"],
                "total_subtasks": num_subtasks,
                "run_dir": str(executor.run_dir)
            })
            
            # 保存中间结果
            _save_stats(stats)
            
        except KeyboardInterrupt:
            print("\n\n⚠️  用户中断，保存当前进度...")
            stats["interrupted"] = True
            stats["interrupted_at"] = idx
            _save_stats(stats)
            sys.exit(1)
        
        except Exception as e:
            print(f"❌ 执行母任务 {study_id} 时出错: {e}")
            stats["failed_studies"] += 1
            stats["results"].append({
                "study_id": study_id,
                "status": "error",
                "error": str(e)
            })
            _save_stats(stats)
    
    # 完成
    stats["end_time"] = datetime.now().isoformat()
    _save_stats(stats)
    
    # 打印总结
    print(f"\n{'='*70}")
    print(f"批量执行完成!")
    print(f"母任务: {stats['completed_studies']}/{stats['total_studies']}")
    print(f"  - 全部通过: {stats['passed_studies']}")
    print(f"  - 有失败: {stats['failed_studies']}")
    print(f"子任务: {stats['passed_subtasks'] + stats['failed_subtasks']}/{stats['total_subtasks']}")
    print(f"  - 通过: {stats['passed_subtasks']}")
    print(f"  - 失败: {stats['failed_subtasks']}")
    print(f"  - 成功率: {stats['passed_subtasks']/(stats['passed_subtasks']+stats['failed_subtasks'])*100:.1f}%")
    print(f"{'='*70}\n")
    
    return stats

def _save_stats(stats: dict):
    """保存统计信息"""
    stats_file = Path("output/Bio_runs/method2_batch_stats.json")
    stats_file.parent.mkdir(parents=True, exist_ok=True)
    with open(stats_file, "w") as f:
        json.dump(stats, f, indent=2)

def run_single_study(study_id: str, max_rounds_per_subtask: int = 3):
    """
    只执行单个母任务
    
    Args:
        study_id: 母任务ID，如 "25303977"
        max_rounds_per_subtask: 每个子任务最多重试次数
    """
    # 查找母任务配置
    num_subtasks = None
    for sid, count in STUDY_CONFIGS:
        if sid == study_id:
            num_subtasks = count
            break
    
    if num_subtasks is None:
        print(f"❌ 未找到母任务: {study_id}")
        return
    
    print(f"\n{'='*70}")
    print(f"执行母任务: {study_id}")
    print(f"子任务数: {num_subtasks}")
    print(f"{'='*70}\n")
    
    executor = StudyTaskExecutor(
        study_id=study_id,
        num_subtasks=num_subtasks,
        max_rounds_per_subtask=max_rounds_per_subtask
    )
    result = executor.execute()
    
    return result

if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="批量执行母任务（方法2）")
    parser.add_argument("--start", type=int, default=0, help="从第几个母任务开始")
    parser.add_argument("--max-rounds", type=int, default=3, help="每个子任务最多重试次数")
    parser.add_argument("--study", type=str, help="只执行指定母任务")
    
    args = parser.parse_args()
    
    if args.study:
        run_single_study(args.study, args.max_rounds)
    else:
        run_all_studies(args.start, args.max_rounds)
