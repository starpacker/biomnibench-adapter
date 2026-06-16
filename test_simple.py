#!/usr/bin/env python3
"""
简单测试：验证单个子任务的执行流程
"""
import subprocess
import sys
from pathlib import Path

def test_single_subtask():
    """测试单个子任务"""
    task_id = "34819518_0"  # 最简单的任务
    tasks_dir = Path("/home/yjh/BioDSBench-imaging101-format/tasks")
    output_dir = Path("/data/yjh/biodsbench-serial-results/test_single")
    output_dir.mkdir(parents=True, exist_ok=True)

    print(f"测试任务: {task_id}")
    print(f"输出目录: {output_dir}")

    # 设置环境变量
    env = {
        "ANTHROPIC_API_KEY": "00gcclg9l39y9p01000dhjzolag1q2hk00901kh1",
        "ANTHROPIC_BASE_URL": "https://api.gpugeek.com",
        "ANTHROPIC_MODEL": "Vendor2/Claude-4.7-opus",
        "ANTHROPIC_SMALL_FAST_MODEL": "Vendor2/Claude-4.7-opus",
        "PATH": subprocess.os.environ.get("PATH", ""),
        "HOME": subprocess.os.environ.get("HOME", ""),
    }

    # 构建命令
    cmd = [
        "bun",
        "src/harness/evaluation/cli.ts",
        "--task", task_id,
        "--tasks-dir", str(tasks_dir),
        "--runs-dir", str(output_dir),
        "--max-rounds", "1",
        "--timeout-seconds", "3600",
        "--temperature", "1",
        "--thinking", "disabled",
        "--agent-runtime", "source"
    ]

    print(f"\n执行命令:")
    print(" ".join(cmd))
    print()

    try:
        result = subprocess.run(
            cmd,
            cwd="/home/yjh/my_claude",
            env=env,
            capture_output=False,  # 直接输出到终端
            timeout=3600
        )

        print(f"\n退出码: {result.returncode}")

        if result.returncode == 0:
            print("✅ 测试成功!")
            # 检查输出
            output_files = list(output_dir.rglob("*.pkl"))
            print(f"\n生成的文件:")
            for f in output_files:
                print(f"  - {f.relative_to(output_dir)}")
        else:
            print("❌ 测试失败!")

    except subprocess.TimeoutExpired:
        print("❌ 超时!")
        return 1
    except Exception as e:
        print(f"❌ 错误: {e}")
        return 1

    return result.returncode

if __name__ == "__main__":
    sys.exit(test_single_subtask())
