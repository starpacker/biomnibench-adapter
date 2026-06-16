#!/usr/bin/env python3
"""
BioDSBench 批量串行测评器
- 13个母任务之间：独立测评（可独立运行）
- 每个母任务内的子任务：串行测评（按顺序执行）
- 结果保存至 /data/yjh/biodsbench-serial-results
"""
import json
import subprocess
import sys
from pathlib import Path
from datetime import datetime
from typing import Dict, List
import argparse

# 母任务配置：study_id -> num_subtasks
STUDY_CONFIGS = {
    "25303977": 8,
    "27959731": 10,
    "28472509": 10,
    "28481359": 9,
    "28985567": 9,
    "29713087": 7,
    "30742119": 8,
    "30867592": 10,
    "32437664": 13,
    "32864625": 6,
    "33765338": 12,
    "34819518": 6,
    "37699004": 10,
}

class BatchSerialExecutor:
    def __init__(self,
                 output_dir: str = "/data/yjh/biodsbench-serial-results",
                 study_filter: List[str] = None,
                 max_rounds_per_subtask: int = 3,
                 timeout_seconds: int = 7200):
        """
        初始化批量测评器

        Args:
            output_dir: 输出目录
            study_filter: 仅测评指定的母任务列表，None表示测评全部
            max_rounds_per_subtask: 每个子任务最多重试次数
            timeout_seconds: 每个子任务的超时时间
        """
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)

        self.study_filter = study_filter
        self.max_rounds_per_subtask = max_rounds_per_subtask
        self.timeout_seconds = timeout_seconds

        # 批次运行信息
        self.batch_id = datetime.now().strftime("%Y%m%d_%H%M%S")
        self.batch_dir = self.output_dir / f"batch_{self.batch_id}"
        self.batch_dir.mkdir(exist_ok=True)

        # 批次状态
        self.batch_state = {
            "batch_id": self.batch_id,
            "start_time": datetime.now().isoformat(),
            "end_time": None,
            "total_studies": 0,
            "completed_studies": 0,
            "passed_studies": 0,
            "failed_studies": 0,
            "studies": []
        }

    def _save_batch_state(self):
        """保存批次状态"""
        state_file = self.batch_dir / "batch_state.json"
        with open(state_file, "w") as f:
            json.dump(self.batch_state, f, indent=2)

    def execute_all(self):
        """执行所有母任务的测评"""
        # 确定要执行的母任务列表
        if self.study_filter:
            studies_to_run = {k: v for k, v in STUDY_CONFIGS.items() if k in self.study_filter}
        else:
            studies_to_run = STUDY_CONFIGS

        self.batch_state["total_studies"] = len(studies_to_run)
        self._save_batch_state()

        print(f"\n{'='*80}")
        print(f"BioDSBench 批量串行测评")
        print(f"批次ID: {self.batch_id}")
        print(f"输出目录: {self.batch_dir}")
        print(f"母任务数量: {len(studies_to_run)}")
        print(f"每个子任务最多重试: {self.max_rounds_per_subtask} 次")
        print(f"{'='*80}\n")

        # 逐个执行母任务
        for idx, (study_id, num_subtasks) in enumerate(studies_to_run.items(), 1):
            print(f"\n{'='*80}")
            print(f"母任务 [{idx}/{len(studies_to_run)}]: {study_id}")
            print(f"子任务数量: {num_subtasks}")
            print(f"{'='*80}")

            study_result = self.execute_study(study_id, num_subtasks)

            self.batch_state["studies"].append(study_result)
            self.batch_state["completed_studies"] += 1

            if study_result["status"] == "passed":
                self.batch_state["passed_studies"] += 1
                print(f"✅ 母任务 {study_id} 通过")
            else:
                self.batch_state["failed_studies"] += 1
                print(f"❌ 母任务 {study_id} 失败")

            self._save_batch_state()

        # 完成
        self.batch_state["end_time"] = datetime.now().isoformat()
        self._save_batch_state()

        # 打印总结
        self.print_summary()

        return self.batch_state

    def execute_study(self, study_id: str, num_subtasks: int) -> Dict:
        """
        执行单个母任务

        Args:
            study_id: 母任务ID
            num_subtasks: 子任务数量

        Returns:
            母任务执行结果
        """
        study_dir = self.batch_dir / study_id
        study_dir.mkdir(exist_ok=True)

        # 调用 study_task_executor.py
        executor_script = Path("/home/yjh/my_claude/study_task_executor.py")

        try:
            # 设置环境变量
            env = {
                "ANTHROPIC_MODEL": "Vendor2/Claude-4.7-opus",
                "ANTHROPIC_SMALL_FAST_MODEL": "Vendor2/Claude-4.7-opus",
                "ANTHROPIC_BASE_URL": "https://api.gpugeek.com",
                "ANTHROPIC_API_KEY": "00gcclg9l39y9p01000dhjzolag1q2hk00901kh1",
                "PATH": "/usr/local/bin:/usr/bin:/bin"
            }

            # 修改 study_task_executor.py 让它使用我们的输出目录
            result = subprocess.run(
                [
                    sys.executable,
                    str(executor_script),
                    study_id,
                    str(num_subtasks),
                    "--runs-dir", str(study_dir)
                ],
                capture_output=True,
                text=True,
                timeout=self.timeout_seconds * num_subtasks,  # 总超时 = 子任务数 * 单个超时
                env=env
            )

            # 读取母任务执行结果
            # study_task_executor 会在 study_dir 下创建一个带时间戳的目录
            study_result_dirs = sorted(study_dir.glob(f"{study_id}_incremental_*"))

            if study_result_dirs:
                latest_result_dir = study_result_dirs[-1]
                state_file = latest_result_dir / "study_state.json"

                if state_file.exists():
                    with open(state_file, "r") as f:
                        return json.load(f)

            # 如果没有找到结果文件，返回失败
            return {
                "study_id": study_id,
                "status": "failed",
                "error": f"No result found. stdout: {result.stdout[:500]}, stderr: {result.stderr[:500]}"
            }

        except subprocess.TimeoutExpired:
            return {
                "study_id": study_id,
                "status": "failed",
                "error": "Timeout"
            }
        except Exception as e:
            return {
                "study_id": study_id,
                "status": "failed",
                "error": str(e)
            }

    def print_summary(self):
        """打印测评总结"""
        print(f"\n{'='*80}")
        print(f"BioDSBench 批量测评完成!")
        print(f"{'='*80}")
        print(f"批次ID: {self.batch_id}")
        print(f"总母任务数: {self.batch_state['total_studies']}")
        print(f"完成: {self.batch_state['completed_studies']}")
        print(f"通过: {self.batch_state['passed_studies']}")
        print(f"失败: {self.batch_state['failed_studies']}")
        print(f"成功率: {self.batch_state['passed_studies']/self.batch_state['total_studies']*100:.1f}%")
        print(f"\n结果保存至: {self.batch_dir}")
        print(f"{'='*80}\n")

        # 详细结果
        print("详细结果:")
        for study in self.batch_state['studies']:
            study_id = study.get('study_id', 'unknown')
            status = study.get('status', 'unknown')
            passed = study.get('passed_subtasks', 0)
            total = study.get('num_subtasks', 0)

            status_icon = "✅" if status == "passed" else "❌"
            print(f"  {status_icon} {study_id}: {passed}/{total} 子任务通过")


def main():
    parser = argparse.ArgumentParser(description="BioDSBench 批量串行测评器")
    parser.add_argument(
        "--studies",
        nargs="+",
        help="指定要测评的母任务ID列表，不指定则测评全部"
    )
    parser.add_argument(
        "--output-dir",
        default="/data/yjh/biodsbench-serial-results",
        help="输出目录"
    )
    parser.add_argument(
        "--max-rounds",
        type=int,
        default=3,
        help="每个子任务最多重试次数"
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=7200,
        help="每个子任务的超时时间（秒）"
    )

    args = parser.parse_args()

    executor = BatchSerialExecutor(
        output_dir=args.output_dir,
        study_filter=args.studies,
        max_rounds_per_subtask=args.max_rounds,
        timeout_seconds=args.timeout
    )

    result = executor.execute_all()

    # 退出码：全部通过返回0，否则返回1
    sys.exit(0 if result["passed_studies"] == result["total_studies"] else 1)


if __name__ == "__main__":
    main()
