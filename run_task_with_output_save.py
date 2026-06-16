#!/usr/bin/env python3
"""
运行单个任务并保存输出文件用于 LLM Judge 评估
"""
import sys
import os
import json
import shutil
from pathlib import Path
from datetime import datetime

# 添加imaging-101到Python路径
imaging101_path = Path("/home/yjh/imaging-101")
sys.path.insert(0, str(imaging101_path))

from evaluation_harness.config import LLMConfig, RunConfig, TaskConfig
from evaluation_harness.runner import BenchmarkRunner


def run_and_save_outputs(task_name: str, task_dir: Path, output_dir: Path):
    """运行任务并保存输出文件"""

    print(f"\n{'='*70}")
    print(f"执行任务: {task_name}")
    print(f"任务目录: {task_dir}")
    print(f"{'='*70}\n")

    # 配置LLM
    llm_config = LLMConfig(
        model="Vendor2/Claude-4.7-opus",
        base_url="https://api.gpugeek.com/v1",
        api_key=os.environ.get("ANTHROPIC_API_KEY", "00gcclg9l39y9p01000dhjzolag1q2hk00901kh1")
    )

    # 配置任务
    task_config = TaskConfig(
        task_name=task_name,
        task_dir=task_dir,
        mode="end_to_end",
        target_function=None
    )

    # 创建任务输出目录
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    task_output_dir = output_dir / task_name / timestamp
    task_output_dir.mkdir(parents=True, exist_ok=True)

    log_file = task_output_dir / f"{task_name}_log.md"

    run_config = RunConfig(
        llm=llm_config,
        task=task_config,
        max_iterations=20,
        docker_image=None,
        timeout_seconds=3600,
        output_dir=task_output_dir,
        log_file=log_file
    )

    try:
        # 运行任务
        runner = BenchmarkRunner(run_config)
        result = runner.run()

        # 获取工作空间路径
        workspace = runner.runner.workspace if hasattr(runner, 'runner') else None

        if workspace and workspace.exists():
            print(f"\n工作空间: {workspace}")

            # 复制输出文件
            trace_src = workspace / "trace.md"
            answer_src = workspace / "answer.txt"

            if trace_src.exists():
                trace_dst = task_output_dir / "trace.md"
                shutil.copy2(trace_src, trace_dst)
                print(f"✅ 已保存 trace.md")
            else:
                print(f"⚠️  未找到 trace.md")

            if answer_src.exists():
                answer_dst = task_output_dir / "answer.txt"
                shutil.copy2(answer_src, answer_dst)
                print(f"✅ 已保存 answer.txt")
            else:
                print(f"⚠️  未找到 answer.txt")

            # 复制其他输出文件
            for pattern in ["*.csv", "*.png", "*.json"]:
                for file in workspace.glob(pattern):
                    dst = task_output_dir / file.name
                    shutil.copy2(file, dst)
                    print(f"✅ 已保存 {file.name}")

        # 保存结果元数据
        result_dict = {
            "task_name": task_name,
            "mode": result.mode if hasattr(result, 'mode') else None,
            "model": result.model if hasattr(result, 'model') else None,
            "timestamp": result.timestamp if hasattr(result, 'timestamp') else datetime.now().isoformat(),
            "iterations": result.iterations if hasattr(result, 'iterations') else 0,
            "wall_time_seconds": result.wall_time_seconds if hasattr(result, 'wall_time_seconds') else 0,
            "workspace": str(workspace) if workspace else None
        }

        result_file = task_output_dir / f"{task_name}_result.json"
        with open(result_file, "w") as f:
            json.dump(result_dict, f, indent=2)

        print(f"\n✅ 任务完成")
        print(f"📁 输出目录: {task_output_dir}")

        return task_output_dir

    except Exception as e:
        print(f"\n❌ 任务执行异常: {e}")
        import traceback
        traceback.print_exc()
        return None


if __name__ == "__main__":
    task_name = "da-1-3"
    task_dir = Path("/data/yjh/biomnibench-organized/da-1-3")
    output_dir = Path("/data/yjh/biomnibench-results")

    result_dir = run_and_save_outputs(task_name, task_dir, output_dir)

    if result_dir:
        print(f"\n{'='*70}")
        print(f"准备运行 LLM Judge:")
        print(f"{'='*70}")
        print(f"trace.md: {result_dir / 'trace.md'}")
        print(f"answer.txt: {result_dir / 'answer.txt'}")
        print(f"rubric: {task_dir / 'evaluation' / 'rubric.txt'}")
