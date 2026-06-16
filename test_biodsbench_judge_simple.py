#!/usr/bin/env python3
"""
简化的BioDSBench judge测试
使用已经生成好的workspace来测试judge功能
"""
import sys
import json
from pathlib import Path

sys.path.insert(0, '/home/yjh/imaging-101')

from evaluation_harness.local_runner import LocalRunner
from evaluation_harness.biodsbench_judge import run_biodsbench_judge


def test_judge_with_existing_workspace(task_id: str, workspace_path: str):
    """
    使用已存在的workspace测试judge
    """

    print("=" * 80)
    print(f"BioDSBench Judge 测试: {task_id}")
    print("=" * 80)
    print()

    task_dir = Path("/home/yjh/BioDSBench-imaging101-format/tasks") / task_id
    workspace = Path(workspace_path)

    if not task_dir.exists():
        print(f"❌ 任务目录不存在: {task_dir}")
        return False

    if not workspace.exists():
        print(f"❌ Workspace不存在: {workspace}")
        return False

    print(f"✅ 任务目录: {task_dir}")
    print(f"✅ Workspace: {workspace}")
    print()

    # 检查main.py
    main_py = workspace / "main.py"
    if not main_py.exists():
        print(f"❌ 没有找到main.py")
        print(f"Workspace内容:")
        for item in workspace.iterdir():
            print(f"  - {item.name}")
        return False

    print(f"✅ 找到main.py")
    print()

    # 创建runner
    runner = LocalRunner(image=None, task_dir=task_dir, timeout=600)
    runner.workspace = workspace
    runner.container = str(workspace)

    # 运行judge
    print("🔍 运行Judge...")
    print()

    judge_result = run_biodsbench_judge(runner, task_dir)

    # 打印结果
    print("=" * 80)
    print("Judge结果")
    print("=" * 80)
    print()

    print(json.dumps(judge_result, indent=2))
    print()

    if "error" in judge_result:
        print(f"❌ Judge失败")
        return False

    tests_total = judge_result.get("tests_total", 0)
    tests_passed = judge_result.get("tests_passed", 0)
    tests_failed = judge_result.get("tests_failed", 0)

    print(f"测试总数: {tests_total}")
    print(f"通过: {tests_passed} ✅")
    print(f"失败: {tests_failed} ❌")

    if tests_total > 0:
        pass_rate = tests_passed / tests_total * 100
        print(f"通过率: {pass_rate:.1f}%")

    print()

    # 详细结果
    if "test_details" in judge_result:
        print("详细结果:")
        for detail in judge_result["test_details"]:
            status_icon = "✅" if detail["status"] == "PASSED" else "❌"
            print(f"  {status_icon} {detail['test']}: {detail['assertion'][:60]}...")
            if detail["status"] != "PASSED" and "error" in detail:
                print(f"     错误: {detail['error']}")

    print()

    success = tests_failed == 0

    print("=" * 80)
    if success:
        print("🎉 所有测试通过!")
    else:
        print("⚠️  部分测试失败")
    print("=" * 80)

    return success


def main():
    import argparse

    parser = argparse.ArgumentParser(description="测试BioDSBench judge")
    parser.add_argument("--task-id", default="25303977_0", help="任务ID")
    parser.add_argument("--workspace", required=True, help="已生成代码的workspace路径")

    args = parser.parse_args()

    success = test_judge_with_existing_workspace(args.task_id, args.workspace)

    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
