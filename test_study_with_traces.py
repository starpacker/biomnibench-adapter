#!/usr/bin/env python3
"""
使用imaging-101 evaluation_harness测试第一个母任务的所有子任务
保存完整轨迹用于分析
"""
import sys
import os
import json
from pathlib import Path
from datetime import datetime

# 添加imaging-101到Python路径
imaging101_path = Path("/home/yjh/imaging-101")
sys.path.insert(0, str(imaging101_path))

from evaluation_harness.config import LLMConfig, RunConfig, TaskConfig
from evaluation_harness.runner import BenchmarkRunner

def run_study(study_id: str, output_dir: Path, stop_on_error: bool = True):
    """运行一个完整的母任务（所有子任务）

    Args:
        study_id: 母任务ID
        output_dir: 输出目录
        stop_on_error: 如果为True，遇到错误立即停止；否则继续执行剩余任务
    """

    tasks_dir = Path("/home/yjh/BioDSBench-imaging101-format/tasks")

    # 找到该母任务的所有子任务（从0到7，不包含combined）
    subtask_dirs = []
    for i in range(8):
        task_path = tasks_dir / f"{study_id}_{i}"
        if task_path.exists():
            subtask_dirs.append(task_path)
        else:
            print(f"⚠️  警告: 子任务 {study_id}_{i} 不存在")

    if not subtask_dirs:
        print(f"❌ 未找到母任务 {study_id} 的子任务")
        return

    print(f"\n{'='*70}")
    print(f"母任务: {study_id}")
    print(f"子任务数量: {len(subtask_dirs)} (0-7)")
    print(f"错误处理: {'遇到错误立即停止' if stop_on_error else '忽略错误继续执行'}")
    print(f"{'='*70}\n")

    # 创建母任务输出目录
    study_output_dir = output_dir / f"{study_id}_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    study_output_dir.mkdir(parents=True, exist_ok=True)

    # 配置LLM（使用正确的端点）
    llm_config = LLMConfig(
        model="Vendor2/Claude-4.7-opus",
        base_url="https://api.gpugeek.com/v1",  # 正确的端点
        api_key="00gcclg9l39y9p01000dhjzolag1q2hk00901kh1"
    )

    results = []
    passed = 0
    failed = 0

    for i, subtask_dir in enumerate(subtask_dirs):
        task_id = subtask_dir.name

        print(f"\n{'='*70}")
        print(f"[{i+1}/{len(subtask_dirs)}] 执行子任务: {task_id}")
        print(f"{'='*70}\n")

        # 配置任务
        task_config = TaskConfig(
            task_name=task_id,
            task_dir=subtask_dir,
            mode="end_to_end",
            target_function=None
        )

        # 创建子任务输出目录
        subtask_output_dir = study_output_dir / task_id
        subtask_output_dir.mkdir(parents=True, exist_ok=True)

        log_file = subtask_output_dir / f"{task_id}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.md"

        run_config = RunConfig(
            llm=llm_config,
            task=task_config,
            max_iterations=20,
            docker_image=None,
            timeout_seconds=3600,
            output_dir=subtask_output_dir,
            log_file=log_file
        )

        try:
            # 运行
            runner = BenchmarkRunner(run_config)
            result = runner.run()

            # 保存结果
            result_dict = {
                "task_id": task_id,
                "subtask_index": i,
                "status": result.stopped_reason,
                "tests_passed": result.tests_passed,
                "tests_total": result.tests_total,
                "test_pass_rate": result.test_pass_rate,
                "quality_metrics": result.quality_metrics,
                "iterations": result.iterations,
                "total_tokens": result.total_tokens,
                "wall_time_seconds": result.wall_time_seconds,
                "files_created": result.files_created,
                "timestamp": datetime.now().isoformat()
            }

            result_file = subtask_output_dir / "result.json"
            with open(result_file, "w") as f:
                json.dump(result_dict, f, indent=2)

            results.append(result_dict)

            # 判断是否通过
            # 因为BioDSBench没有ground truth，我们检查是否成功生成了文件
            if result.files_created and len(result.files_created) > 0:
                passed += 1
                print(f"✅ 子任务 {task_id} 完成 - 生成了 {len(result.files_created)} 个文件")
            else:
                failed += 1
                print(f"❌ 子任务 {task_id} 失败 - 未生成文件")

            print(f"迭代: {result.iterations}, Token: {result.total_tokens}, 时间: {result.wall_time_seconds:.1f}秒")

        except Exception as e:
            import traceback
            error_msg = traceback.format_exc()
            print(f"\n{'='*70}")
            print(f"❌ 子任务 {task_id} 执行出错!")
            print(f"{'='*70}")
            print(f"错误: {e}")
            print(f"详细信息:\n{error_msg}")
            print(f"{'='*70}\n")

            failed += 1
            error_dict = {
                "task_id": task_id,
                "subtask_index": i,
                "status": "error",
                "error": str(e),
                "traceback": error_msg,
                "timestamp": datetime.now().isoformat()
            }
            results.append(error_dict)

            # 保存错误信息到文件
            error_file = subtask_output_dir / "error.json"
            with open(error_file, "w") as f:
                json.dump(error_dict, f, indent=2)

            # 如果设置了stop_on_error，立即停止
            if stop_on_error:
                print(f"⚠️  因为遇到错误，停止执行后续任务")
                print(f"已完成: {i+1}/{len(subtask_dirs)} 个子任务")
                break

    # 保存母任务总结
    summary = {
        "study_id": study_id,
        "total_subtasks": len(subtask_dirs),
        "passed": passed,
        "failed": failed,
        "success_rate": passed / len(subtask_dirs) if subtask_dirs else 0,
        "results": results,
        "timestamp": datetime.now().isoformat()
    }

    summary_file = study_output_dir / "study_summary.json"
    with open(summary_file, "w") as f:
        json.dump(summary, f, indent=2)

    # 打印总结
    print(f"\n{'='*70}")
    print(f"母任务 {study_id} 完成!")
    print(f"{'='*70}")
    print(f"总子任务数: {len(subtask_dirs)}")
    print(f"通过: {passed}")
    print(f"失败: {failed}")
    print(f"成功率: {passed / len(subtask_dirs) * 100:.1f}%")
    print(f"\n结果保存至: {study_output_dir}")
    print(f"{'='*70}\n")

    return summary

def main():
    import argparse

    parser = argparse.ArgumentParser(description="测试BioDSBench母任务")
    parser.add_argument("--study-id", default="25303977", help="母任务ID")
    parser.add_argument("--output-dir", default="/data/yjh/biodsbench-test-results", help="输出目录")
    parser.add_argument("--continue-on-error", action="store_true",
                        help="遇到错误后继续执行剩余任务（默认遇到错误立即停止）")

    args = parser.parse_args()

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    summary = run_study(args.study_id, output_dir, stop_on_error=not args.continue_on_error)

    # 返回退出码
    if summary and summary["passed"] > 0:
        sys.exit(0)
    else:
        sys.exit(1)

if __name__ == "__main__":
    main()
