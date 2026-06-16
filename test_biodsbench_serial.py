#!/usr/bin/env python3
"""
BioDSBench串行测评
后续任务可以访问前面任务的上下文和输出
"""
import sys
import json
import subprocess
from pathlib import Path
from datetime import datetime

sys.path.insert(0, '/home/yjh/imaging-101')


def run_serial_tasks(task_ids: list[str], output_dir: Path):
    """
    串行运行多个任务，每个任务可以访问前面任务的上下文
    """

    print("=" * 80)
    print(f"BioDSBench 串行测评")
    print(f"任务数量: {len(task_ids)}")
    print(f"任务列表: {', '.join(task_ids)}")
    print("=" * 80)
    print()

    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    run_output_dir = output_dir / f"serial_run_{timestamp}"
    run_output_dir.mkdir(parents=True, exist_ok=True)

    print(f"输出目录: {run_output_dir}")
    print()

    results = []

    # 串行执行每个任务
    for i, task_id in enumerate(task_ids, 1):
        print("=" * 80)
        print(f"任务 {i}/{len(task_ids)}: {task_id}")
        print("=" * 80)
        print()

        task_start = datetime.now()

        # 运行simple_task_executor
        cmd = [
            sys.executable,
            "/home/yjh/my_claude/simple_task_executor.py",
            "--task-id", task_id,
            "--output-dir", str(run_output_dir)
        ]

        print(f"执行命令: {' '.join(cmd)}")
        print()

        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=600  # 10分钟超时
        )

        task_duration = (datetime.now() - task_start).total_seconds()

        # 解析结果
        task_output_dir = run_output_dir / task_id
        result_file = task_output_dir / "result.json"

        if result_file.exists():
            with open(result_file) as f:
                task_result = json.load(f)
        else:
            task_result = {
                "task_id": task_id,
                "status": "error",
                "error": "No result.json found"
            }

        task_result["duration_seconds"] = task_duration
        task_result["stdout_preview"] = result.stdout[:500] if result.stdout else ""
        task_result["stderr_preview"] = result.stderr[:500] if result.stderr else ""
        task_result["return_code"] = result.returncode

        results.append(task_result)

        # 打印任务结果
        print()
        print("-" * 80)
        print(f"任务 {task_id} 完成")
        print("-" * 80)

        status = task_result.get("status", "unknown")
        tests_passed = task_result.get("tests_passed", 0)
        tests_total = task_result.get("tests_total", 0)

        if status == "done" and tests_total > 0:
            pass_rate = tests_passed / tests_total * 100
            print(f"✅ 状态: {status}")
            print(f"✅ 测试: {tests_passed}/{tests_total} 通过 ({pass_rate:.0f}%)")
        else:
            print(f"⚠️  状态: {status}")
            if tests_total > 0:
                print(f"⚠️  测试: {tests_passed}/{tests_total} 通过")
            else:
                print(f"❌ 没有测试结果")

        print(f"⏱️  时间: {task_duration:.1f}秒")
        print(f"📁 输出: {task_output_dir}")
        print()

        # 如果任务失败，打印错误信息
        if status not in ["done", "success"]:
            print("错误信息:")
            if result.stderr:
                print(result.stderr[:1000])
            print()

    # 生成汇总报告
    print("=" * 80)
    print("串行测评汇总")
    print("=" * 80)
    print()

    summary = {
        "timestamp": timestamp,
        "total_tasks": len(task_ids),
        "task_ids": task_ids,
        "results": results,
        "output_dir": str(run_output_dir)
    }

    # 统计
    successful = sum(1 for r in results if r.get("status") == "done")
    total_tests_passed = sum(r.get("tests_passed", 0) for r in results)
    total_tests = sum(r.get("tests_total", 0) for r in results)
    total_time = sum(r.get("duration_seconds", 0) for r in results)
    total_tokens = sum(r.get("total_tokens", 0) for r in results)

    print(f"任务完成: {successful}/{len(task_ids)}")
    if total_tests > 0:
        print(f"测试通过: {total_tests_passed}/{total_tests} ({total_tests_passed/total_tests*100:.1f}%)")
    print(f"总时间: {total_time:.1f}秒")
    print(f"总Token: {total_tokens}")
    print()

    # 详细结果
    print("详细结果:")
    print()
    for i, (task_id, result) in enumerate(zip(task_ids, results), 1):
        status = result.get("status", "unknown")
        tests_passed = result.get("tests_passed", 0)
        tests_total = result.get("tests_total", 0)
        duration = result.get("duration_seconds", 0)

        status_icon = "✅" if status == "done" else "❌"
        test_info = f"{tests_passed}/{tests_total}" if tests_total > 0 else "N/A"

        print(f"  {i}. {status_icon} {task_id}: {status} | 测试 {test_info} | {duration:.1f}s")

    print()

    # 保存汇总结果
    summary_file = run_output_dir / "serial_summary.json"
    with open(summary_file, 'w') as f:
        json.dump(summary, f, indent=2)

    print(f"汇总结果已保存: {summary_file}")
    print()

    # 判断整体是否成功
    all_success = all(r.get("status") == "done" for r in results)

    print("=" * 80)
    if all_success:
        print("🎉 所有任务串行测评成功!")
    else:
        print("⚠️  部分任务失败")
    print("=" * 80)

    return all_success, summary


def main():
    import argparse

    parser = argparse.ArgumentParser(description="BioDSBench串行测评")
    parser.add_argument("--task-prefix", default="25303977", help="任务ID前缀")
    parser.add_argument("--start", type=int, default=0, help="起始索引")
    parser.add_argument("--end", type=int, default=1, help="结束索引（包含）")
    parser.add_argument("--output-dir", default="/data/yjh/biodsbench-serial-test", help="输出目录")

    args = parser.parse_args()

    # 生成任务ID列表
    task_ids = [f"{args.task_prefix}_{i}" for i in range(args.start, args.end + 1)]

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    success, summary = run_serial_tasks(task_ids, output_dir)

    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
