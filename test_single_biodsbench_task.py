#!/usr/bin/env python3
"""
测试单个BioDSBench任务的完整流程：
1. Agent生成main.py
2. 运行main.py生成输出
3. Judge检查输出是否正确
"""
import sys
import os
import json
import shutil
import subprocess
from pathlib import Path
from datetime import datetime

# 添加imaging-101到路径
sys.path.insert(0, '/home/yjh/imaging-101')

from evaluation_harness.config import LLMConfig, RunConfig, TaskConfig
from evaluation_harness.runner import BenchmarkRunner
from evaluation_harness.biodsbench_judge import run_biodsbench_judge
from evaluation_harness.local_runner import LocalRunner


def test_biodsbench_task(task_id: str, output_base: Path):
    """
    完整测试一个BioDSBench任务
    """

    print("=" * 80)
    print(f"BioDSBench 任务测评: {task_id}")
    print("=" * 80)
    print()

    # 任务目录
    task_dir = Path("/home/yjh/BioDSBench-imaging101-format/tasks") / task_id

    if not task_dir.exists():
        print(f"❌ 任务目录不存在: {task_dir}")
        return False

    # 检查是否有test_cases.py
    test_cases = task_dir / "evaluation" / "test_cases.py"
    if not test_cases.exists():
        print(f"❌ 不是BioDSBench任务 (没有test_cases.py)")
        return False

    print(f"✅ 任务目录: {task_dir}")
    print(f"✅ 测试文件: {test_cases}")
    print()

    # ==================================================================
    # Phase 1: Agent生成代码
    # ==================================================================

    print("-" * 80)
    print("Phase 1: Agent生成main.py")
    print("-" * 80)
    print()

    # 创建输出目录
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    workspace_dir = output_base / f"{task_id}_{timestamp}"
    workspace_dir.mkdir(parents=True, exist_ok=True)

    print(f"工作目录: {workspace_dir}")
    print()

    # 配置LLM
    llm_config = LLMConfig(
        model="Vendor2/Claude-4.7-opus",
        base_url="https://api.gpugeek.com/v1",
        api_key="00gcclg9l39y9p01000dhjzolag1q2hk00901kh1"
    )

    # 配置任务
    task_config = TaskConfig(
        task_name=task_id,
        task_dir=task_dir,
        mode="end_to_end",
        target_function=None
    )

    # 配置运行
    log_file = workspace_dir / f"{task_id}.md"

    run_config = RunConfig(
        llm=llm_config,
        task=task_config,
        max_iterations=20,
        docker_image=None,
        timeout_seconds=1800,  # 30分钟
        output_dir=workspace_dir,
        log_file=log_file
    )

    try:
        # 运行agent生成代码
        print("🤖 启动Agent生成代码...")
        benchmark_runner = BenchmarkRunner(run_config)
        result = benchmark_runner.run()

        print()
        print(f"✅ Agent完成")
        print(f"   状态: {result.stopped_reason}")
        print(f"   迭代: {result.iterations}")
        print(f"   Token: {result.total_tokens}")
        print(f"   时间: {result.wall_time_seconds:.1f}秒")
        print()

        # 获取实际的workspace路径
        actual_workspace = benchmark_runner.runner.workspace
        print(f"实际workspace: {actual_workspace}")
        print()

        # 复制生成的文件到output_dir
        if actual_workspace and actual_workspace.exists():
            import shutil
            for item in actual_workspace.iterdir():
                if item.name not in ['.venv', '.cache', '__pycache__']:
                    dst = workspace_dir / item.name
                    if item.is_dir():
                        if dst.exists():
                            shutil.rmtree(dst)
                        shutil.copytree(item, dst)
                    else:
                        shutil.copy2(item, dst)
            print(f"✅ 文件已复制到: {workspace_dir}")
            print()

    except Exception as e:
        print(f"❌ Agent执行失败: {e}")
        import traceback
        traceback.print_exc()
        return False

    # 检查main.py是否生成
    main_py = workspace_dir / "main.py"
    if not main_py.exists():
        print(f"❌ Agent没有生成main.py")
        print(f"   workspace_dir内容: {list(workspace_dir.iterdir())}")
        return False

    print(f"✅ 找到生成的main.py")
    print()

    # ==================================================================
    # Phase 2: 运行main.py生成输出
    # ==================================================================

    print("-" * 80)
    print("Phase 2: 运行main.py生成输出")
    print("-" * 80)
    print()

    # 预处理main.py - 替换路径
    try:
        main_content = main_py.read_text()
        main_content = main_content.replace('/workdir/', str(task_dir / 'workdir') + '/')
        main_content = main_content.replace('/workdir', str(task_dir / 'workdir'))
        main_content = main_content.replace('/workspace/', str(workspace_dir) + '/')
        main_content = main_content.replace('/workspace', str(workspace_dir))
        main_py.write_text(main_content)
        print("✅ 路径替换完成")
    except Exception as e:
        print(f"⚠️  路径替换失败: {e}")

    print()
    print("🔧 执行main.py...")
    print()

    try:
        # 运行main.py
        result = subprocess.run(
            [sys.executable, str(main_py)],
            cwd=str(workspace_dir),
            capture_output=True,
            text=True,
            timeout=600
        )

        if result.returncode != 0:
            print(f"❌ main.py执行失败 (返回码: {result.returncode})")
            print()
            print("STDOUT:")
            print(result.stdout[:500])
            print()
            print("STDERR:")
            print(result.stderr[:500])
            return False

        print("✅ main.py执行成功")
        if result.stdout:
            print()
            print("输出:")
            print(result.stdout[:300])
        print()

    except subprocess.TimeoutExpired:
        print("❌ main.py执行超时 (>10分钟)")
        return False
    except Exception as e:
        print(f"❌ 运行main.py失败: {e}")
        return False

    # 检查输出文件
    output_files = [
        workspace_dir / "output" / "substitution_ratios.csv",
        workspace_dir / "substitution_ratios.csv",
        workspace_dir / "output" / "results.csv",
        workspace_dir / "results.csv",
    ]

    found_output = None
    for f in output_files:
        if f.exists():
            found_output = f
            print(f"✅ 找到输出文件: {f.relative_to(workspace_dir)}")
            break

    if not found_output:
        print("❌ 没有找到输出CSV文件")
        print(f"   查找过: {[str(f.relative_to(workspace_dir)) for f in output_files if f.parent.exists()]}")
        return False

    print()

    # ==================================================================
    # Phase 3: Judge检查输出
    # ==================================================================

    print("-" * 80)
    print("Phase 3: Judge检查输出")
    print("-" * 80)
    print()

    # 创建LocalRunner指向workspace
    local_runner = LocalRunner(container=str(workspace_dir))

    print("🔍 运行Judge...")
    print()

    # 运行judge
    judge_result = run_biodsbench_judge(local_runner, task_dir)

    # 打印结果
    print("=" * 80)
    print("Judge结果")
    print("=" * 80)
    print()

    if "error" in judge_result:
        print(f"❌ Judge执行失败")
        print(f"   错误: {judge_result['error']}")
        if 'stdout' in judge_result:
            print(f"   stdout: {judge_result['stdout'][:300]}")
        if 'stderr' in judge_result:
            print(f"   stderr: {judge_result['stderr'][:300]}")
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

    # 打印详细结果
    if "test_details" in judge_result:
        print("详细结果:")
        for detail in judge_result["test_details"]:
            status_icon = "✅" if detail["status"] == "PASSED" else "❌"
            print(f"  {status_icon} {detail['test']}: {detail['assertion']}")
            if detail["status"] != "PASSED" and "error" in detail:
                print(f"     错误: {detail['error']}")

    print()

    # 保存结果
    result_file = workspace_dir / "judge_result.json"
    with open(result_file, 'w') as f:
        json.dump(judge_result, f, indent=2)

    print(f"结果已保存到: {result_file}")
    print()

    # 最终判断
    success = tests_failed == 0

    print("=" * 80)
    if success:
        print("🎉 测评通过!")
    else:
        print("⚠️  测评未通过")
    print("=" * 80)
    print()

    return success


def main():
    import argparse

    parser = argparse.ArgumentParser(description="测试BioDSBench单个任务")
    parser.add_argument("--task-id", default="25303977_0", help="任务ID")
    parser.add_argument("--output-dir", default="/data/yjh/biodsbench-test", help="输出目录")

    args = parser.parse_args()

    output_base = Path(args.output_dir)
    output_base.mkdir(parents=True, exist_ok=True)

    success = test_biodsbench_task(args.task_id, output_base)

    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
