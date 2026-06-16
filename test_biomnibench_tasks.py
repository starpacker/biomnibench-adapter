#!/usr/bin/env python3
"""
测试 biomnibench-organized 中的所有任务
这些是独立的单任务，不是母任务-子任务结构
"""
import sys
import os
import json
from pathlib import Path
from datetime import datetime
import subprocess

# 添加imaging-101到Python路径
imaging101_path = Path("/home/yjh/imaging-101")
sys.path.insert(0, str(imaging101_path))

from evaluation_harness.config import LLMConfig, RunConfig, TaskConfig
from evaluation_harness.runner import BenchmarkRunner

def get_all_tasks(base_dir: Path):
    """获取所有任务目录"""
    tasks = []
    for task_dir in sorted(base_dir.iterdir()):
        if task_dir.is_dir() and (task_dir.name.startswith("da-") or task_dir.name == "conventional_ptychography"):
            # 检查是否有必要的文件
            if (task_dir / "task_manifest.json").exists() or (task_dir / "task.toml").exists():
                tasks.append(task_dir.name)
    return tasks

def run_single_task(task_name: str, task_dir: Path, output_dir: Path):
    """运行单个任务"""

    print(f"\n{'='*70}")
    print(f"执行任务: {task_name}")
    print(f"任务目录: {task_dir}")
    print(f"{'='*70}\n")

    # 用于保存输出文件的全局变量
    saved_files = {}

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
    task_output_dir = output_dir / task_name / datetime.now().strftime('%Y%m%d_%H%M%S')
    task_output_dir.mkdir(parents=True, exist_ok=True)

    log_file = task_output_dir / f"{task_name}_log.md"

    run_config = RunConfig(
        llm=llm_config,
        task=task_config,
        max_iterations=20,
        docker_image=None,
        timeout_seconds=3600,  # 1小时超时
        output_dir=task_output_dir,
        log_file=log_file
    )

    try:
        # 运行任务
        runner = BenchmarkRunner(run_config)

        # Monkey patch LocalRunner.stop() to copy files before cleanup
        import shutil
        local_runner = runner.runner
        original_stop = local_runner.stop

        def patched_stop():
            # Copy files BEFORE cleanup
            if local_runner.workspace and local_runner.workspace.exists():
                print(f"\n📁 工作空间: {local_runner.workspace}")

                # 复制主要输出文件
                for filename in ["trace.md", "answer.txt"]:
                    src = local_runner.workspace / filename
                    if src.exists():
                        dst = task_output_dir / filename
                        shutil.copy2(src, dst)
                        print(f"✅ 已保存 {filename}")
                    else:
                        print(f"⚠️  未找到 {filename}")

                # 复制其他输出文件
                for pattern in ["*.csv", "*.png"]:
                    for file in local_runner.workspace.glob(pattern):
                        dst = task_output_dir / file.name
                        shutil.copy2(file, dst)
                        print(f"✅ 已保存 {file.name}")

                # 复制 figures 目录（如果存在）
                figures_src = local_runner.workspace / "figures"
                if figures_src.exists() and figures_src.is_dir():
                    figures_dst = task_output_dir / "figures"
                    shutil.copytree(figures_src, figures_dst, dirs_exist_ok=True)
                    print(f"✅ 已保存 figures/ 目录")

            # Now call original cleanup
            original_stop()

        local_runner.stop = patched_stop

        # Run the task
        result = runner.run()

        # 保存结果
        result_file = task_output_dir / f"{task_name}_result.json"

        # EvalResult 对象转换为字典
        result_dict = {
            "task_name": task_name,
            "mode": result.mode if hasattr(result, 'mode') else None,
            "model": result.model if hasattr(result, 'model') else None,
            "timestamp": result.timestamp if hasattr(result, 'timestamp') else datetime.now().isoformat(),
            "tests_total": result.tests_total if hasattr(result, 'tests_total') else 0,
            "tests_passed": result.tests_passed if hasattr(result, 'tests_passed') else 0,
            "test_pass_rate": result.test_pass_rate if hasattr(result, 'test_pass_rate') else 0.0,
            "iterations": result.iterations if hasattr(result, 'iterations') else 0,
            "wall_time_seconds": result.wall_time_seconds if hasattr(result, 'wall_time_seconds') else 0,
            "stopped_reason": result.stopped_reason if hasattr(result, 'stopped_reason') else None,
            "files_created": result.files_created if hasattr(result, 'files_created') else []
        }

        with open(result_file, "w") as f:
            json.dump(result_dict, f, indent=2)

        # 计算是否通过（根据测试通过率）
        passed = result.test_pass_rate >= 0.5 if hasattr(result, 'test_pass_rate') else False
        status = "✅ 通过" if passed else "❌ 失败"
        print(f"\n{status} {task_name}")
        print(f"测试通过率: {result.test_pass_rate if hasattr(result, 'test_pass_rate') else 0.0:.1%}")
        print(f"迭代次数: {result.iterations if hasattr(result, 'iterations') else 0}")
        print(f"运行时间: {result.wall_time_seconds if hasattr(result, 'wall_time_seconds') else 0:.1f}秒")

        return {
            "task_name": task_name,
            "status": "success" if passed else "failed",
            "passed": passed,
            "test_pass_rate": result.test_pass_rate if hasattr(result, 'test_pass_rate') else 0.0,
            "iterations": result.iterations if hasattr(result, 'iterations') else 0,
            "wall_time_seconds": result.wall_time_seconds if hasattr(result, 'wall_time_seconds') else 0,
            "error": None
        }

    except Exception as e:
        print(f"\n❌ 任务 {task_name} 执行异常: {e}")
        import traceback
        traceback.print_exc()

        # 保存错误信息
        error_file = task_output_dir / f"{task_name}_error.json"
        with open(error_file, "w") as f:
            json.dump({
                "task_name": task_name,
                "status": "error",
                "error": str(e),
                "traceback": traceback.format_exc(),
                "timestamp": datetime.now().isoformat()
            }, f, indent=2)

        return {
            "task_name": task_name,
            "status": "error",
            "passed": False,
            "score": 0.0,
            "error": str(e)
        }

def main():
    base_dir = Path("/data/yjh/biomnibench-organized")
    output_dir = Path("/data/yjh/biomnibench-results")
    output_dir.mkdir(parents=True, exist_ok=True)

    # 获取所有任务
    all_tasks = get_all_tasks(base_dir)

    print(f"\n{'='*70}")
    print(f"BioMniBench 任务测评")
    print(f"{'='*70}")
    print(f"任务数量: {len(all_tasks)}")
    print(f"输出目录: {output_dir}")
    print(f"{'='*70}\n")

    print("任务列表:")
    for i, task_name in enumerate(all_tasks, 1):
        print(f"  {i:2d}. {task_name}")
    print()

    # 创建总结文件
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    summary_file = output_dir / f"summary_{timestamp}.json"

    results = []
    total = len(all_tasks)

    for idx, task_name in enumerate(all_tasks, 1):
        print(f"\n{'#'*70}")
        print(f"进度: [{idx}/{total}] 任务 {task_name}")
        print(f"{'#'*70}")

        task_dir = base_dir / task_name
        start_time = datetime.now()

        result = run_single_task(task_name, task_dir, output_dir)

        end_time = datetime.now()
        duration = (end_time - start_time).total_seconds()

        result["index"] = idx
        result["start_time"] = start_time.isoformat()
        result["end_time"] = end_time.isoformat()
        result["duration_seconds"] = duration

        results.append(result)

        # 保存进度
        with open(summary_file, "w") as f:
            json.dump({
                "total_tasks": total,
                "completed": idx,
                "passed": sum(1 for r in results if r.get("passed", False)),
                "failed": sum(1 for r in results if not r.get("passed", False)),
                "results": results
            }, f, indent=2)

        print(f"\n⏱️  用时: {duration:.1f}秒")
        print(f"📊 累计进度: {idx}/{total}")

    # 全部完成
    print(f"\n{'='*70}")
    print(f"🎉 全部 {total} 个任务测评完成!")
    print(f"{'='*70}\n")

    passed = sum(1 for r in results if r.get("passed", False))
    failed = sum(1 for r in results if not r.get("passed", False))
    errors = sum(1 for r in results if r.get("status") == "error")

    summary = {
        "total_tasks": total,
        "completed": total,
        "passed": passed,
        "failed": failed,
        "errors": errors,
        "success_rate": passed / total if total > 0 else 0,
        "timestamp": timestamp,
        "results": results
    }

    with open(summary_file, "w") as f:
        json.dump(summary, f, indent=2)

    print(f"📄 总结文件: {summary_file}")
    print(f"✅ 通过: {passed}/{total}")
    print(f"❌ 失败: {failed}/{total}")
    print(f"⚠️  错误: {errors}/{total}")
    print(f"📈 成功率: {passed/total*100:.1f}%")

    return 0 if failed == 0 and errors == 0 else 1

if __name__ == "__main__":
    sys.exit(main())
