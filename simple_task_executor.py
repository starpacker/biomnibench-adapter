#!/usr/bin/env python3
"""
简化的任务执行器 - 使用imaging-101的evaluation harness
每个子任务独立运行，不使用串行上下文累积
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

def run_single_task(task_id: str, output_dir: Path):
    """运行单个BioDSBench任务"""

    # BioDSBench任务在BioDSBench-imaging101-format/tasks/目录
    task_dir = Path("/home/yjh/BioDSBench-imaging101-format/tasks") / task_id

    if not task_dir.exists():
        print(f"❌ 任务目录不存在: {task_dir}")
        return {"status": "error", "error": "Task directory not found"}

    print(f"\n{'='*70}")
    print(f"执行任务: {task_id}")
    print(f"任务目录: {task_dir}")
    print(f"{'='*70}\n")

    # 配置LLM
    # 使用完整的模型路径和正确的base_url（需要包含/v1）
    llm_config = LLMConfig(
        model="Vendor2/Claude-4.7-opus",
        base_url="https://api.gpugeek.com/v1",  # 添加 /v1
        api_key="00gcclg9l39y9p01000dhjzolag1q2hk00901kh1"
    )

    # 配置任务
    task_config = TaskConfig(
        task_name=task_id,
        task_dir=task_dir,
        mode="end_to_end",  # 端到端模式
        target_function=None
    )

    # 配置运行
    task_output_dir = output_dir / task_id
    task_output_dir.mkdir(parents=True, exist_ok=True)

    log_file = task_output_dir / f"{task_id}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.md"

    run_config = RunConfig(
        llm=llm_config,
        task=task_config,
        max_iterations=20,
        docker_image=None,  # 不使用Docker
        timeout_seconds=3600,
        output_dir=task_output_dir,
        log_file=log_file
    )

    try:
        # 运行
        runner = BenchmarkRunner(run_config)
        result = runner.run()

        # 保存结果
        result_dict = {
            "task_id": task_id,
            "status": result.stopped_reason,
            "tests_passed": result.tests_passed,
            "tests_total": result.tests_total,
            "test_pass_rate": result.test_pass_rate,
            "quality_metrics": result.quality_metrics,
            "iterations": result.iterations,
            "total_tokens": result.total_tokens,
            "wall_time_seconds": result.wall_time_seconds,
            "timestamp": datetime.now().isoformat()
        }

        result_file = task_output_dir / "result.json"
        with open(result_file, "w") as f:
            json.dump(result_dict, f, indent=2)

        # 打印结果
        print(f"\n{'='*70}")
        print(f"任务 {task_id} 完成!")
        print(f"状态: {result.stopped_reason}")
        if result.tests_total > 0:
            print(f"测试: {result.tests_passed}/{result.tests_total} 通过 ({result.test_pass_rate:.0%})")
        print(f"迭代: {result.iterations}")
        print(f"Token: {result.total_tokens}")
        print(f"时间: {result.wall_time_seconds:.1f}秒")
        print(f"{'='*70}\n")

        return result_dict

    except Exception as e:
        import traceback
        error_msg = traceback.format_exc()
        print(f"❌ 任务执行失败: {e}")
        print(error_msg)

        return {
            "task_id": task_id,
            "status": "error",
            "error": str(e),
            "traceback": error_msg,
            "timestamp": datetime.now().isoformat()
        }

def main():
    import argparse

    parser = argparse.ArgumentParser(description="简化的BioDSBench任务执行器")
    parser.add_argument("--task-id", required=True, help="任务ID，如 25303977_0")
    parser.add_argument("--output-dir", default="/data/yjh/biodsbench-simple-results", help="输出目录")

    args = parser.parse_args()

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    result = run_single_task(args.task_id, output_dir)

    # 返回退出码
    if result.get("status") in ["success", "max_iterations"]:
        sys.exit(0)
    else:
        sys.exit(1)

if __name__ == "__main__":
    main()
