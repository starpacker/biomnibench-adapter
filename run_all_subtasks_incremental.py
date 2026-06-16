#!/usr/bin/env python3
"""
批量执行所有118个子任务（方法2：增量执行）
"""
import sys
import json
from pathlib import Path
from datetime import datetime
from get_all_subtasks import get_all_subtasks, STUDY_CONFIGS
from subtask_executor import SubtaskExecutor

def run_all_subtasks(start_index: int = 0, max_rounds: int = 3):
    """
    执行所有子任务
    
    Args:
        start_index: 从第几个子任务开始（用于断点续传）
        max_rounds: 每个子任务最多重试次数
    """
    all_subtasks = get_all_subtasks()
    total = len(all_subtasks)
    
    print(f"\n{'='*70}")
    print(f"方法2：增量执行 - 批量运行所有子任务")
    print(f"总任务数: {total}")
    print(f"开始索引: {start_index}")
    print(f"最大重试: {max_rounds}")
    print(f"{'='*70}\n")
    
    # 统计信息
    stats = {
        "total": total,
        "completed": 0,
        "passed": 0,
        "failed": 0,
        "skipped": start_index,
        "start_time": datetime.now().isoformat(),
        "results": []
    }
    
    # 执行每个子任务
    for idx, (study_id, task_idx, task_id) in enumerate(all_subtasks):
        if idx < start_index:
            continue
        
        print(f"\n{'='*70}")
        print(f"进度: [{idx+1}/{total}] - {task_id}")
        print(f"母任务: {study_id}, 子任务索引: {task_idx}")
        print(f"{'='*70}")
        
        try:
            # 执行子任务
            executor = SubtaskExecutor(
                task_id=task_id,
                max_rounds=max_rounds
            )
            result = executor.execute()
            
            # 记录结果
            stats["completed"] += 1
            if result["status"] == "passed":
                stats["passed"] += 1
                print(f"✅ {task_id} 通过")
            else:
                stats["failed"] += 1
                print(f"❌ {task_id} 失败")
            
            stats["results"].append({
                "task_id": task_id,
                "status": result["status"],
                "rounds": result["current_round"],
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
            print(f"❌ 执行 {task_id} 时出错: {e}")
            stats["failed"] += 1
            stats["results"].append({
                "task_id": task_id,
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
    print(f"总计: {stats['total']}")
    print(f"完成: {stats['completed']}")
    print(f"通过: {stats['passed']}")
    print(f"失败: {stats['failed']}")
    print(f"跳过: {stats['skipped']}")
    print(f"成功率: {stats['passed']/stats['completed']*100:.1f}%")
    print(f"{'='*70}\n")
    
    return stats

def _save_stats(stats: dict):
    """保存统计信息"""
    stats_file = Path("output/Bio_runs/incremental_batch_stats.json")
    stats_file.parent.mkdir(parents=True, exist_ok=True)
    with open(stats_file, "w") as f:
        json.dump(stats, f, indent=2)

def run_by_study(study_id: str, max_rounds: int = 3):
    """
    只执行某个母任务的所有子任务
    
    Args:
        study_id: 母任务ID，如 "25303977"
        max_rounds: 每个子任务最多重试次数
    """
    all_subtasks = get_all_subtasks()
    study_subtasks = [(sid, idx, tid) for sid, idx, tid in all_subtasks if sid == study_id]
    
    if not study_subtasks:
        print(f"❌ 未找到母任务: {study_id}")
        return
    
    print(f"\n{'='*70}")
    print(f"执行母任务: {study_id}")
    print(f"子任务数: {len(study_subtasks)}")
    print(f"{'='*70}\n")
    
    stats = {
        "study_id": study_id,
        "total": len(study_subtasks),
        "passed": 0,
        "failed": 0,
        "results": []
    }
    
    for study_id, task_idx, task_id in study_subtasks:
        print(f"\n执行: {task_id}")
        
        try:
            executor = SubtaskExecutor(task_id=task_id, max_rounds=max_rounds)
            result = executor.execute()
            
            if result["status"] == "passed":
                stats["passed"] += 1
                print(f"✅ {task_id} 通过")
            else:
                stats["failed"] += 1
                print(f"❌ {task_id} 失败")
            
            stats["results"].append({
                "task_id": task_id,
                "status": result["status"],
                "rounds": result["current_round"]
            })
        
        except Exception as e:
            print(f"❌ 执行 {task_id} 时出错: {e}")
            stats["failed"] += 1
    
    # 打印总结
    print(f"\n{'='*70}")
    print(f"母任务 {study_id} 执行完成!")
    print(f"通过: {stats['passed']}/{stats['total']}")
    print(f"失败: {stats['failed']}/{stats['total']}")
    print(f"成功率: {stats['passed']/stats['total']*100:.1f}%")
    print(f"{'='*70}\n")
    
    return stats

if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="批量执行子任务（方法2）")
    parser.add_argument("--start", type=int, default=0, help="从第几个子任务开始")
    parser.add_argument("--max-rounds", type=int, default=3, help="每个子任务最多重试次数")
    parser.add_argument("--study", type=str, help="只执行指定母任务的子任务")
    
    args = parser.parse_args()
    
    if args.study:
        run_by_study(args.study, args.max_rounds)
    else:
        run_all_subtasks(args.start, args.max_rounds)
