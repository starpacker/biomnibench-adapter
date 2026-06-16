#!/usr/bin/env python3
"""
完整的BioDSBench任务测试 - 使用simple_task_executor + judge
"""
import sys
import json
import subprocess
from pathlib import Path

sys.path.insert(0, '/home/yjh/imaging-101')

from evaluation_harness.local_runner import LocalRunner
from evaluation_harness.biodsbench_judge import run_biodsbench_judge


def run_complete_test(task_id: str, output_dir: Path):
    """
    完整测试流程：
    1. 使用simple_task_executor运行agent生成代码
    2. 从临时workspace复制文件
    3. 运行judge测试
    """

    print("=" * 80)
    print(f"BioDSBench完整测试: {task_id}")
    print("=" * 80)
    print()

    task_dir = Path("/home/yjh/BioDSBench-imaging101-format/tasks") / task_id

    if not task_dir.exists():
        print(f"❌ 任务目录不存在: {task_dir}")
        return False

    # Phase 1: 运行simple_task_executor
    print("-" * 80)
    print("Phase 1: Agent生成代码")
    print("-" * 80)
    print()

    cmd = [
        sys.executable,
        "/home/yjh/my_claude/simple_task_executor.py",
        "--task-id", task_id,
        "--output-dir", str(output_dir)
    ]

    print(f"执行命令: {' '.join(cmd)}")
    print()

    result = subprocess.run(cmd, capture_output=True, text=True)

    if result.returncode != 0:
        print("❌ Agent执行失败")
        print("STDOUT:", result.stdout[:1000])
        print("STDERR:", result.stderr[:1000])
        return False

    print("✅ Agent执行完成")
    print()

    # 查找生成的workspace
    task_output_dir = output_dir / task_id
    if not task_output_dir.exists():
        print(f"❌ 输出目录不存在: {task_output_dir}")
        return False

    # 查找最新的运行结果
    result_files = list(task_output_dir.glob("*.json"))
    if not result_files:
        print(f"❌ 没有找到结果文件")
        return False

    result_file = max(result_files, key=lambda p: p.stat().st_mtime)
    print(f"结果文件: {result_file}")

    with open(result_file) as f:
        agent_result = json.load(f)

    print(f"Agent状态: {agent_result.get('status')}")
    print(f"迭代次数: {agent_result.get('iterations')}")
    print()

    # 现在问题是：文件在哪里？
    # simple_task_executor使用BenchmarkRunner，它会把文件放在临时workspace
    # 我们需要找到那个workspace

    # 策略：查找最近创建的imaging101-local-*目录
    import time
    time.sleep(2)  # 等待文件系统同步

    tmp_workspaces = list(Path("/tmp").glob("imaging101-local-*"))
    if not tmp_workspaces:
        print("❌ 没有找到临时workspace")
        return False

    # 按修改时间排序，取最新的
    latest_workspace = max(tmp_workspaces, key=lambda p: p.stat().st_mtime)
    print(f"找到临时workspace: {latest_workspace}")

    # 检查是否有main.py
    main_py = latest_workspace / "main.py"
    if not main_py.exists():
        print(f"❌ workspace中没有main.py")
        print(f"Workspace内容:")
        for item in latest_workspace.iterdir():
            if not item.name.startswith('.'):
                print(f"  - {item.name}")
        return False

    print(f"✅ 找到main.py")
    print()

    # Phase 2: 复制文件到持久目录
    print("-" * 80)
    print("Phase 2: 复制生成的文件")
    print("-" * 80)
    print()

    workspace_backup = task_output_dir / "workspace"
    workspace_backup.mkdir(exist_ok=True)

    import shutil
    for item in latest_workspace.iterdir():
        if item.name not in ['.venv', '.cache', '__pycache__']:
            dst = workspace_backup / item.name
            try:
                if item.is_dir():
                    if dst.exists():
                        shutil.rmtree(dst)
                    shutil.copytree(item, dst)
                else:
                    shutil.copy2(item, dst)
                print(f"  复制: {item.name}")
            except Exception as e:
                print(f"  ⚠️  复制失败 {item.name}: {e}")

    print(f"✅ 文件已复制到: {workspace_backup}")
    print()

    # Phase 3: 运行judge
    print("-" * 80)
    print("Phase 3: Judge测试")
    print("-" * 80)
    print()

    # 创建runner
    runner = LocalRunner(image=None, task_dir=task_dir, timeout=600)
    runner.workspace = workspace_backup
    runner.container = str(workspace_backup)

    print("🔍 运行Judge...")
    judge_result = run_biodsbench_judge(runner, task_dir)

    print()
    print("=" * 80)
    print("Judge结果")
    print("=" * 80)
    print()

    if "error" in judge_result:
        print(f"❌ Judge失败")
        print(f"错误: {judge_result['error']}")
        if 'stdout' in judge_result:
            print(f"stdout: {judge_result['stdout'][:500]}")
        if 'stderr' in judge_result:
            print(f"stderr: {judge_result['stderr'][:500]}")
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
            assertion = detail['assertion'][:70]
            print(f"  {status_icon} {detail['test']}: {assertion}")
            if detail["status"] != "PASSED" and "error" in detail:
                print(f"     错误: {detail['error']}")

    print()

    # 保存结果
    judge_result_file = workspace_backup / "judge_result.json"
    with open(judge_result_file, 'w') as f:
        json.dump(judge_result, f, indent=2)

    print(f"结果已保存: {judge_result_file}")
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

    parser = argparse.ArgumentParser(description="BioDSBench完整测试")
    parser.add_argument("--task-id", default="25303977_0", help="任务ID")
    parser.add_argument("--output-dir", default="/data/yjh/biodsbench-complete-test", help="输出目录")

    args = parser.parse_args()

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    success = run_complete_test(args.task_id, output_dir)

    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
