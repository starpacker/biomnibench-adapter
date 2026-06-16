#!/usr/bin/env python3
"""
轨迹分析工具：帮助分析BioDSBench测评中模型的错误

用法:
    python3 analyze_traces.py --batch-dir /data/yjh/biodsbench-serial-results/batch_20260606_143022
    python3 analyze_traces.py --study-id 25303977 --batch-dir /data/...
    python3 analyze_traces.py --task-id 25303977_0 --batch-dir /data/...
"""

import json
import argparse
from pathlib import Path
from typing import Dict, List
from collections import defaultdict

class TraceAnalyzer:
    def __init__(self, batch_dir: str):
        self.batch_dir = Path(batch_dir)

    def analyze_batch(self) -> Dict:
        """分析整个批次的执行情况"""
        print(f"\n{'='*70}")
        print(f"批次轨迹分析")
        print(f"批次目录: {self.batch_dir}")
        print(f"{'='*70}\n")

        # 读取批次状态
        batch_state_file = self.batch_dir / "batch_state.json"
        if not batch_state_file.exists():
            print(f"❌ 批次状态文件不存在: {batch_state_file}")
            return {}

        with open(batch_state_file, "r") as f:
            batch_state = json.load(f)

        print(f"📊 批次统计:")
        print(f"  - 总母任务数: {batch_state.get('total_studies', 0)}")
        print(f"  - 通过: {batch_state.get('passed_studies', 0)}")
        print(f"  - 失败: {batch_state.get('failed_studies', 0)}")
        print(f"  - 成功率: {batch_state.get('passed_studies', 0) / max(batch_state.get('total_studies', 1), 1) * 100:.1f}%")

        # 分析每个母任务
        study_dirs = [d for d in self.batch_dir.iterdir() if d.is_dir() and d.name.isdigit()]

        failed_tasks = []
        error_types = defaultdict(int)

        for study_dir in sorted(study_dirs):
            study_id = study_dir.name
            incremental_dirs = list(study_dir.glob(f"{study_id}_incremental_*"))

            if not incremental_dirs:
                continue

            # 使用最新的运行目录
            latest_dir = sorted(incremental_dirs, reverse=True)[0]
            study_state_file = latest_dir / "study_state.json"

            if not study_state_file.exists():
                continue

            with open(study_state_file, "r") as f:
                study_state = json.load(f)

            if study_state.get("status") == "failed":
                # 找到失败的子任务
                for subtask in study_state.get("subtasks", []):
                    if subtask.get("status") == "failed":
                        task_id = subtask.get("task_id")
                        error = subtask.get("rounds", [{}])[-1].get("error", "Unknown error")

                        failed_tasks.append({
                            "study_id": study_id,
                            "task_id": task_id,
                            "error": error[:200]  # 截断过长的错误
                        })

                        # 统计错误类型
                        error_type = self._categorize_error(error)
                        error_types[error_type] += 1

        # 打印失败分析
        if failed_tasks:
            print(f"\n❌ 失败的任务 ({len(failed_tasks)}):")
            for task in failed_tasks[:10]:  # 只显示前10个
                print(f"\n  📍 {task['task_id']}")
                print(f"     错误: {task['error']}")

        print(f"\n📈 错误类型分布:")
        for error_type, count in sorted(error_types.items(), key=lambda x: x[1], reverse=True):
            print(f"  - {error_type}: {count}")

        return {
            "batch_state": batch_state,
            "failed_tasks": failed_tasks,
            "error_types": dict(error_types)
        }

    def analyze_study(self, study_id: str) -> Dict:
        """分析单个母任务的详细执行情况"""
        print(f"\n{'='*70}")
        print(f"母任务详细分析: {study_id}")
        print(f"{'='*70}\n")

        study_dir = self.batch_dir / study_id
        if not study_dir.exists():
            print(f"❌ 母任务目录不存在: {study_dir}")
            return {}

        incremental_dirs = list(study_dir.glob(f"{study_id}_incremental_*"))
        if not incremental_dirs:
            print(f"❌ 未找到运行目录")
            return {}

        latest_dir = sorted(incremental_dirs, reverse=True)[0]
        study_state_file = latest_dir / "study_state.json"

        with open(study_state_file, "r") as f:
            study_state = json.load(f)

        print(f"📊 母任务统计:")
        print(f"  - 状态: {study_state.get('status')}")
        print(f"  - 子任务总数: {study_state.get('num_subtasks')}")
        print(f"  - 通过: {study_state.get('passed_subtasks')}")
        print(f"  - 失败: {study_state.get('failed_subtasks')}")

        # 分析每个子任务
        print(f"\n📋 子任务详情:")
        for subtask in study_state.get("subtasks", []):
            task_id = subtask.get("task_id")
            status = subtask.get("status")
            rounds = subtask.get("rounds", [])

            print(f"\n  {'✅' if status == 'passed' else '❌'} {task_id}")
            print(f"     状态: {status}")
            print(f"     尝试轮次: {len(rounds)}")

            if status == "failed" and rounds:
                last_round = rounds[-1]
                print(f"     最后错误: {last_round.get('error', 'Unknown')[:200]}")

                # 检查是否有生成的代码
                subtask_idx = int(task_id.split('_')[-1])
                code_file = latest_dir / f"subtask_{subtask_idx}" / "generated_code.py"
                if code_file.exists():
                    print(f"     生成的代码: {code_file}")

                # 检查是否有评测详情
                eval_detail_file = latest_dir / f"{task_id}_eval_detailed.json"
                if eval_detail_file.exists():
                    print(f"     评测详情: {eval_detail_file}")

        return study_state

    def analyze_task(self, task_id: str) -> Dict:
        """深度分析单个子任务的执行轨迹"""
        print(f"\n{'='*70}")
        print(f"子任务深度分析: {task_id}")
        print(f"{'='*70}\n")

        study_id = task_id.rsplit('_', 1)[0]
        subtask_idx = int(task_id.split('_')[-1])

        study_dir = self.batch_dir / study_id
        if not study_dir.exists():
            print(f"❌ 母任务目录不存在: {study_dir}")
            return {}

        incremental_dirs = list(study_dir.glob(f"{study_id}_incremental_*"))
        if not incremental_dirs:
            print(f"❌ 未找到运行目录")
            return {}

        latest_dir = sorted(incremental_dirs, reverse=True)[0]
        subtask_dir = latest_dir / f"subtask_{subtask_idx}"

        if not subtask_dir.exists():
            print(f"❌ 子任务目录不存在: {subtask_dir}")
            return {}

        analysis = {
            "task_id": task_id,
            "rounds": []
        }

        # 分析每一轮
        round_dirs = sorted(subtask_dir.glob("round_*"))

        print(f"📋 执行了 {len(round_dirs)} 轮")

        for round_dir in round_dirs:
            round_num = int(round_dir.name.split('_')[1])
            print(f"\n{'='*50}")
            print(f"Round {round_num}")
            print(f"{'='*50}")

            round_analysis = {
                "round": round_num,
                "files": {}
            }

            # 1. 任务描述
            desc_file = round_dir / "task_description.txt"
            if desc_file.exists():
                print(f"\n📄 任务描述:")
                with open(desc_file, "r") as f:
                    description = f.read()
                    print(f"  {description[:300]}...")
                    round_analysis["files"]["description"] = str(desc_file)

            # 2. 上下文信息
            context_file = round_dir / "context.json"
            if context_file.exists():
                print(f"\n🔗 上下文:")
                with open(context_file, "r") as f:
                    context = json.load(f)
                    print(f"  - 当前子任务索引: {context.get('current_subtask_idx')}")
                    print(f"  - 前置子任务数: {len(context.get('previous_subtasks', []))}")
                    if context.get('retry_info'):
                        print(f"  - 重试轮次: {context['retry_info'].get('previous_round')}")
                    round_analysis["files"]["context"] = str(context_file)
                    round_analysis["context"] = context

            # 3. 生成的代码
            code_file = round_dir / "generated_code.py"
            if code_file.exists():
                print(f"\n💻 生成的代码:")
                with open(code_file, "r") as f:
                    code = f.read()
                    lines = code.split('\n')
                    print(f"  - 代码行数: {len(lines)}")
                    print(f"  - 前10行:")
                    for line in lines[:10]:
                        print(f"    {line}")
                    round_analysis["files"]["code"] = str(code_file)
                    round_analysis["code_lines"] = len(lines)

            # 4. CLI输出日志
            log_file = round_dir / "cli_output.log"
            if log_file.exists():
                print(f"\n📝 CLI执行日志:")
                with open(log_file, "r") as f:
                    log = f.read()
                    # 提取关键信息
                    if "Exit code:" in log:
                        exit_code = log.split("Exit code:")[1].split('\n')[0].strip()
                        print(f"  - 退出码: {exit_code}")
                        round_analysis["exit_code"] = exit_code
                    round_analysis["files"]["log"] = str(log_file)

            # 5. Agent轨迹
            traces_dir = round_dir / "agent_traces"
            if traces_dir.exists():
                trace_files = list(traces_dir.iterdir())
                print(f"\n🔍 Agent轨迹文件: {len(trace_files)}")
                for trace_file in trace_files:
                    print(f"  - {trace_file.name}")
                round_analysis["trace_files"] = [str(f) for f in trace_files]

            analysis["rounds"].append(round_analysis)

        # 评测结果
        eval_result_file = latest_dir / f"{task_id}_eval_result.json"
        eval_detailed_file = latest_dir / f"{task_id}_eval_detailed.json"

        if eval_detailed_file.exists():
            print(f"\n{'='*50}")
            print(f"评测结果")
            print(f"{'='*50}")

            with open(eval_detailed_file, "r") as f:
                eval_data = json.load(f)

            eval_result = eval_data.get("evaluation", {})
            print(f"\n📊 评测状态: {eval_result.get('status')}")

            if eval_result.get('status') == 'fail':
                print(f"\n❌ 失败原因:")
                feedback = eval_result.get('feedback', 'No feedback')
                print(f"  {feedback[:500]}")

                if eval_data.get('evaluator_stderr'):
                    print(f"\n⚠️  评测器错误输出:")
                    print(f"  {eval_data['evaluator_stderr'][:500]}")

            analysis["evaluation"] = eval_data

        # 生成分析报告
        print(f"\n{'='*70}")
        print(f"分析总结")
        print(f"{'='*70}")

        print(f"\n📂 关键文件位置:")
        print(f"  - 子任务目录: {subtask_dir}")
        if eval_detailed_file.exists():
            print(f"  - 评测详情: {eval_detailed_file}")

        return analysis

    def _categorize_error(self, error: str) -> str:
        """将错误信息分类"""
        error_lower = error.lower()

        if "timeout" in error_lower:
            return "超时错误"
        elif "import" in error_lower or "module" in error_lower:
            return "导入错误"
        elif "file not found" in error_lower or "no such file" in error_lower:
            return "文件未找到"
        elif "syntax" in error_lower:
            return "语法错误"
        elif "type" in error_lower:
            return "类型错误"
        elif "value" in error_lower:
            return "值错误"
        elif "assertion" in error_lower or "test" in error_lower:
            return "测试失败"
        elif "evaluation failed" in error_lower:
            return "评测失败"
        else:
            return "其他错误"

    def export_failed_cases(self, output_file: str):
        """导出所有失败案例的详细信息到JSON文件"""
        print(f"\n导出失败案例到: {output_file}")

        study_dirs = [d for d in self.batch_dir.iterdir() if d.is_dir() and d.name.isdigit()]

        failed_cases = []

        for study_dir in sorted(study_dirs):
            study_id = study_dir.name
            incremental_dirs = list(study_dir.glob(f"{study_id}_incremental_*"))

            if not incremental_dirs:
                continue

            latest_dir = sorted(incremental_dirs, reverse=True)[0]
            study_state_file = latest_dir / "study_state.json"

            if not study_state_file.exists():
                continue

            with open(study_state_file, "r") as f:
                study_state = json.load(f)

            for subtask in study_state.get("subtasks", []):
                if subtask.get("status") == "failed":
                    task_id = subtask.get("task_id")
                    subtask_idx = int(task_id.split('_')[-1])

                    # 收集该失败任务的所有信息
                    case = {
                        "task_id": task_id,
                        "study_id": study_id,
                        "subtask_idx": subtask_idx,
                        "rounds": subtask.get("rounds", []),
                        "files": {}
                    }

                    # 收集文件路径
                    subtask_dir = latest_dir / f"subtask_{subtask_idx}"
                    if subtask_dir.exists():
                        case["files"]["subtask_dir"] = str(subtask_dir)

                        # 生成的代码
                        code_file = subtask_dir / "generated_code.py"
                        if code_file.exists():
                            case["files"]["code"] = str(code_file)

                        # 任务描述
                        desc_file = subtask_dir / "task_description.txt"
                        if desc_file.exists():
                            case["files"]["description"] = str(desc_file)

                    # 评测详情
                    eval_file = latest_dir / f"{task_id}_eval_detailed.json"
                    if eval_file.exists():
                        case["files"]["evaluation"] = str(eval_file)

                    failed_cases.append(case)

        # 保存到文件
        with open(output_file, "w") as f:
            json.dump(failed_cases, f, indent=2, ensure_ascii=False)

        print(f"✅ 已导出 {len(failed_cases)} 个失败案例")

def main():
    parser = argparse.ArgumentParser(description="BioDSBench轨迹分析工具")
    parser.add_argument("--batch-dir", required=True, help="批次目录路径")
    parser.add_argument("--study-id", help="分析特定母任务")
    parser.add_argument("--task-id", help="深度分析特定子任务")
    parser.add_argument("--export-failures", help="导出失败案例到JSON文件")

    args = parser.parse_args()

    analyzer = TraceAnalyzer(args.batch_dir)

    if args.task_id:
        # 深度分析单个子任务
        analyzer.analyze_task(args.task_id)
    elif args.study_id:
        # 分析单个母任务
        analyzer.analyze_study(args.study_id)
    else:
        # 分析整个批次
        analyzer.analyze_batch()

    if args.export_failures:
        analyzer.export_failed_cases(args.export_failures)

if __name__ == "__main__":
    main()
