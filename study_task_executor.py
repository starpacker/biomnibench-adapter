#!/usr/bin/env python3
"""
母任务执行器：执行单个母任务的所有子任务
子任务之间增量执行、上下文累积
母任务之间相互独立
"""
import json
import subprocess
import sys
from pathlib import Path
from datetime import datetime
from typing import Dict, List, Optional

class StudyTaskExecutor:
    def __init__(self, 
                 study_id: str,
                 num_subtasks: int,
                 tasks_dir: str = "tasks",
                 runs_dir: str = "output/Bio_runs",
                 max_rounds_per_subtask: int = 3,
                 timeout_seconds: int = 7200):
        self.study_id = study_id
        self.num_subtasks = num_subtasks
        self.tasks_dir = Path(tasks_dir).absolute()
        self.runs_dir = Path(runs_dir).absolute()
        self.max_rounds_per_subtask = max_rounds_per_subtask
        self.timeout_seconds = timeout_seconds
        
        # 创建母任务运行目录
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        self.run_dir = self.runs_dir / f"{study_id}_incremental_{timestamp}"
        self.run_dir.mkdir(parents=True, exist_ok=True)
        
        # 输出目录（所有子任务共享）
        self.outputs_dir = self.run_dir / "outputs"
        self.outputs_dir.mkdir(exist_ok=True)
        
        # 母任务状态
        self.state = {
            "study_id": study_id,
            "num_subtasks": num_subtasks,
            "status": "not_started",
            "completed_subtasks": 0,
            "passed_subtasks": 0,
            "failed_subtasks": 0,
            "subtasks": [],
            "start_time": datetime.now().isoformat(),
            "end_time": None
        }
        self._save_state()
    
    def _save_state(self):
        """保存母任务状态"""
        state_file = self.run_dir / "study_state.json"
        with open(state_file, "w") as f:
            json.dump(self.state, f, indent=2)
    
    def execute(self) -> Dict:
        """
        执行母任务的所有子任务
        
        Returns:
            执行结果字典
        """
        print(f"\n{'='*70}")
        print(f"开始执行母任务: {self.study_id}")
        print(f"子任务数量: {self.num_subtasks}")
        print(f"运行目录: {self.run_dir}")
        print(f"每个子任务最多重试: {self.max_rounds_per_subtask} 次")
        print(f"{'='*70}\n")

        # 标记运行中
        self.state["status"] = "running"
        self._save_state()
        
        # 执行每个子任务
        for subtask_idx in range(self.num_subtasks):
            task_id = f"{self.study_id}_{subtask_idx}"
            
            print(f"\n{'='*70}")
            print(f"子任务 [{subtask_idx+1}/{self.num_subtasks}]: {task_id}")
            print(f"{'='*70}")
            
            # 执行子任务
            result = self._execute_subtask(task_id, subtask_idx)
            
            # 记录结果
            self.state["subtasks"].append(result)
            self.state["completed_subtasks"] += 1
            
            if result["status"] == "passed":
                self.state["passed_subtasks"] += 1
                print(f"✅ {task_id} 通过")
            else:
                self.state["failed_subtasks"] += 1
                print(f"❌ {task_id} 失败")
                # fail-fast: 任一子任务失败则母任务直接失败，不再继续后续子任务
                self._save_state()
                print(f"⚠️  检测到子任务失败，母任务 {self.study_id} 提前终止")
                break
            
            self._save_state()
        
        # 完成
        self.state["end_time"] = datetime.now().isoformat()
        if self.state["passed_subtasks"] == self.num_subtasks:
            self.state["status"] = "passed"
        else:
            self.state["status"] = "failed"
        self._save_state()
        
        # 打印总结
        print(f"\n{'='*70}")
        print(f"母任务 {self.study_id} 执行完成!")
        print(f"通过: {self.state['passed_subtasks']}/{self.num_subtasks}")
        print(f"失败: {self.state['failed_subtasks']}/{self.num_subtasks}")
        print(f"成功率: {self.state['passed_subtasks']/self.num_subtasks*100:.1f}%")
        print(f"{'='*70}\n")
        
        return self.state
    
    def _execute_subtask(self, task_id: str, subtask_idx: int) -> Dict:
        """
        执行单个子任务，支持重试
        
        Args:
            task_id: 子任务ID，如 "25303977_0"
            subtask_idx: 子任务索引
        
        Returns:
            子任务执行结果
        """
        subtask_dir = self.run_dir / f"subtask_{subtask_idx}"
        subtask_dir.mkdir(exist_ok=True)
        
        result = {
            "task_id": task_id,
            "subtask_index": subtask_idx,
            "status": "failed",
            "rounds": [],
            "start_time": datetime.now().isoformat(),
            "end_time": None
        }
        
        # 尝试最多 max_rounds_per_subtask 次
        for round_num in range(1, self.max_rounds_per_subtask + 1):
            print(f"\n  --- Round {round_num}/{self.max_rounds_per_subtask} ---")
            
            round_dir = subtask_dir / f"round_{round_num}"
            round_dir.mkdir(exist_ok=True)
            
            round_result = {
                "round": round_num,
                "status": "failed",
                "start_time": datetime.now().isoformat(),
                "end_time": None,
                "error": None
            }
            
            try:
                # 1. 构建上下文（包含前面已完成的子任务）
                print(f"  1. 构建上下文...")
                context = self._build_context(subtask_idx, round_num, result)
                
                # 2. 调用 CLI 执行
                print(f"  2. 调用 BioDSBench CLI...")
                cli_result = self._run_cli(task_id, round_dir, context)
                
                # 注意：即使CLI返回失败（因为内置judge失败），
                # 只要输出文件存在，我们仍然用增量评测器来评测
                if not cli_result["success"]:
                    print(f"  ⚠️  CLI 返回失败（可能是内置judge失败），检查输出文件...")
                
                # 3. 验证输出（使用增量评测器）
                print(f"  3. 使用增量评测器验证输出...")
                validation_result = self._validate_output(task_id)
                
                if validation_result["passed"]:
                    round_result["status"] = "passed"
                    round_result["end_time"] = datetime.now().isoformat()
                    result["rounds"].append(round_result)
                    result["status"] = "passed"
                    result["end_time"] = datetime.now().isoformat()
                    print(f"  ✅ Round {round_num} 通过!")
                    return result
                else:
                    round_result["error"] = validation_result.get("error", "Validation failed")
                    round_result["end_time"] = datetime.now().isoformat()
                    result["rounds"].append(round_result)
                    print(f"  ❌ 验证失败: {round_result['error'][:200]}")
            
            except Exception as e:
                round_result["error"] = str(e)
                round_result["end_time"] = datetime.now().isoformat()
                result["rounds"].append(round_result)
                print(f"  ❌ 执行出错: {e}")
        
        # 所有轮次都失败
        result["end_time"] = datetime.now().isoformat()
        return result
    
    def _build_context(self, current_subtask_idx: int, round_num: int, current_result: Dict) -> Dict:
        """
        构建上下文：包含前面已完成的子任务的输出、代码和描述

        Args:
            current_subtask_idx: 当前子任务索引
            round_num: 当前轮次
            current_result: 当前子任务的结果（用于获取前一轮的错误）

        Returns:
            完整的上下文字典，包含：
            - previous_subtasks: 前面子任务的详细信息（代码、描述、输出）
            - retry_info: 重试信息（如果是重试）
            - available_outputs: 可用的输出文件列表
        """
        context = {
            "current_subtask_idx": current_subtask_idx,
            "round_num": round_num,
            "previous_subtasks": [],
            "retry_info": None,
            "available_outputs": []
        }

        # 1. 收集前面已完成的子任务信息
        if current_subtask_idx > 0:
            for prev_idx in range(current_subtask_idx):
                prev_task_id = f"{self.study_id}_{prev_idx}"
                prev_result = self.state["subtasks"][prev_idx]

                prev_info = {
                    "task_id": prev_task_id,
                    "subtask_idx": prev_idx,
                    "status": prev_result["status"],
                    "description": None,
                    "generated_code": None,
                    "output_files": []
                }

                if prev_result["status"] == "passed":
                    # 读取生成的代码
                    code_file = self.run_dir / f"subtask_{prev_idx}" / "generated_code.py"
                    if code_file.exists():
                        with open(code_file, "r") as f:
                            prev_info["generated_code"] = f.read()

                    # 读取任务描述
                    desc_file = self.run_dir / f"subtask_{prev_idx}" / "task_description.txt"
                    if desc_file.exists():
                        with open(desc_file, "r") as f:
                            prev_info["description"] = f.read()

                    # 列出输出文件
                    output_files = list(self.outputs_dir.glob(f"*{prev_idx}*.*"))
                    prev_info["output_files"] = [f.name for f in output_files]
                    context["available_outputs"].extend(prev_info["output_files"])

                context["previous_subtasks"].append(prev_info)

        # 2. 如果是重试，添加前一轮的详细错误信息
        if round_num > 1 and current_result["rounds"]:
            prev_round = current_result["rounds"][-1]
            context["retry_info"] = {
                "previous_round": round_num - 1,
                "error": prev_round.get("error"),
                "failed_code": None
            }

            # 读取失败的代码
            failed_code_file = self.run_dir / f"subtask_{current_subtask_idx}" / f"round_{round_num-1}" / "generated_code.py"
            if failed_code_file.exists():
                with open(failed_code_file, "r") as f:
                    context["retry_info"]["failed_code"] = f.read()

        return context
    
    def _run_cli(self, task_id: str, round_dir: Path, context: Dict) -> Dict:
        """调用 BioDSBench CLI"""
        # 设置环境变量
        env = {
            **subprocess.os.environ.copy(),
            "BIODSBENCH_OUTPUTS_DIR": str(self.outputs_dir.absolute()),
            # 加载LLM配置
            "ANTHROPIC_API_KEY": "00gcclg9l39y9p01000dhjzolag1q2hk00901kh1",
            "ANTHROPIC_BASE_URL": "https://api.gpugeek.com/v1",  # 修正：添加/v1
            "ANTHROPIC_MODEL": "Vendor2/Claude-4.7-opus",
            "ANTHROPIC_SMALL_FAST_MODEL": "Vendor2/Claude-4.7-opus",
            "AGENT_LOG_DIR": str(Path.cwd() / "output")
        }
        
        # 构建命令
        cmd = [
            "bun",
            "src/harness/evaluation/cli.ts",
            "--task", task_id,
            "--tasks-dir", str(self.tasks_dir.absolute()),
            "--runs-dir", str(self.run_dir.absolute()),
            "--max-rounds", "1",  # 每次只执行一轮
            "--timeout-seconds", str(self.timeout_seconds),
            "--temperature", "1",
            "--thinking", "disabled",
            "--agent-runtime", "source"
        ]
        
        try:
            # 执行命令
            result = subprocess.run(
                cmd,
                cwd=str(Path.cwd()),
                env=env,
                capture_output=True,
                text=True,
                timeout=self.timeout_seconds
            )
            
            # 保存CLI执行日志
            log_file = round_dir / "cli_output.log"
            with open(log_file, "w") as f:
                f.write(f"Command: {' '.join(cmd)}\n")
                f.write(f"Exit code: {result.returncode}\n\n")
                f.write("STDOUT:\n")
                f.write(result.stdout)
                f.write("\n\nSTDERR:\n")
                f.write(result.stderr)

            # 保存上下文信息（用于后续分析）
            context_file = round_dir / "context.json"
            with open(context_file, "w") as f:
                json.dump(context, f, indent=2, ensure_ascii=False)

            # 尝试提取并保存AI生成的代码
            # BioDSBench CLI 会在运行目录中保存生成的代码
            self._extract_and_save_generated_code(task_id, round_dir)

            # 保存任务描述
            self._save_task_description(task_id, round_dir)

            if result.returncode != 0:
                return {
                    "success": False,
                    "error": f"CLI failed with exit code {result.returncode}"
                }

            return {"success": True}
            
        except subprocess.TimeoutExpired:
            return {
                "success": False,
                "error": f"Timeout after {self.timeout_seconds} seconds"
            }
        except Exception as e:
            return {
                "success": False,
                "error": str(e)
            }

    def _extract_and_save_generated_code(self, task_id: str, round_dir: Path):
        """
        从CLI运行目录中提取AI生成的代码并保存

        BioDSBench CLI会在 run_dir/task_id_timestamp/ 中保存执行轨迹
        我们需要找到最新的运行目录并提取生成的代码
        """
        try:
            # 找到CLI创建的任务运行目录
            task_run_dirs = [d for d in self.run_dir.glob(f"{task_id}_*") if d.is_dir()]
            if not task_run_dirs:
                print(f"  ⚠️  未找到{task_id}的运行目录，无法提取代码")
                return

            # 使用最新的运行目录
            latest_run_dir = sorted(task_run_dirs, reverse=True)[0]

            # BioDSBench的CLI会保存agent轨迹
            # 查找可能的代码文件位置
            possible_code_locations = [
                latest_run_dir / "agent_code.py",
                latest_run_dir / "generated_code.py",
                latest_run_dir / "solution.py",
            ]

            # 也检查outputs目录中的.py文件
            outputs_dir = latest_run_dir / "outputs"
            if outputs_dir.exists():
                possible_code_locations.extend(outputs_dir.glob("*.py"))

            # 也检查根目录下的所有.py文件
            possible_code_locations.extend(latest_run_dir.glob("*.py"))

            # 找到第一个存在的代码文件
            generated_code = None
            source_file = None
            for code_file in possible_code_locations:
                if code_file.exists() and code_file.is_file():
                    with open(code_file, "r") as f:
                        content = f.read()
                        # 简单检查：至少包含一些Python代码特征
                        if any(keyword in content for keyword in ["import", "def ", "class ", "if __name__"]):
                            generated_code = content
                            source_file = code_file
                            break

            if generated_code:
                # 保存到round目录
                save_path = round_dir / "generated_code.py"
                with open(save_path, "w") as f:
                    f.write(generated_code)
                print(f"  📝 已保存生成的代码: {save_path.relative_to(self.run_dir)}")
                print(f"     (源: {source_file.relative_to(self.run_dir)})")

                # 也保存到子任务根目录（用于后续子任务的上下文）
                subtask_idx = int(task_id.split('_')[-1])
                subtask_root = self.run_dir / f"subtask_{subtask_idx}"
                subtask_code_path = subtask_root / "generated_code.py"
                with open(subtask_code_path, "w") as f:
                    f.write(generated_code)
            else:
                print(f"  ⚠️  未找到生成的代码文件")

            # 额外：保存完整的agent轨迹（如果存在）
            agent_log_files = list(latest_run_dir.glob("**/agent*.log")) + \
                             list(latest_run_dir.glob("**/conversation*.json")) + \
                             list(latest_run_dir.glob("**/trace*.json"))

            if agent_log_files:
                traces_dir = round_dir / "agent_traces"
                traces_dir.mkdir(exist_ok=True)
                for log_file in agent_log_files:
                    import shutil
                    shutil.copy2(log_file, traces_dir / log_file.name)
                print(f"  📋 已保存{len(agent_log_files)}个agent轨迹文件")

        except Exception as e:
            print(f"  ⚠️  提取代码时出错: {e}")

    def _save_task_description(self, task_id: str, round_dir: Path):
        """
        保存任务描述（从task.json中提取）
        """
        try:
            task_dir = self.tasks_dir / task_id
            task_json = task_dir / "task.json"

            if not task_json.exists():
                return

            with open(task_json, "r") as f:
                task_data = json.load(f)

            # 提取任务描述
            description_parts = []

            if "instruction" in task_data:
                description_parts.append("## 任务指令")
                description_parts.append(task_data["instruction"])

            if "background" in task_data:
                description_parts.append("\n## 背景信息")
                description_parts.append(task_data["background"])

            if "requirements" in task_data:
                description_parts.append("\n## 要求")
                if isinstance(task_data["requirements"], list):
                    for req in task_data["requirements"]:
                        description_parts.append(f"- {req}")
                else:
                    description_parts.append(task_data["requirements"])

            description = "\n".join(description_parts)

            # 保存到round目录
            desc_file = round_dir / "task_description.txt"
            with open(desc_file, "w") as f:
                f.write(description)

            # 也保存到子任务根目录
            subtask_idx = int(task_id.split('_')[-1])
            subtask_root = self.run_dir / f"subtask_{subtask_idx}"
            subtask_desc_file = subtask_root / "task_description.txt"
            with open(subtask_desc_file, "w") as f:
                f.write(description)

            print(f"  📄 已保存任务描述")

        except Exception as e:
            print(f"  ⚠️  保存任务描述时出错: {e}")

    
    def _validate_output(self, task_id: str) -> Dict:
        """验证输出文件 - 使用增量评测器，并保存详细的评测结果"""
        task_dir = self.tasks_dir / task_id

        if not task_dir.exists():
            return {
                "passed": False,
                "error": f"Task directory not found: {task_dir}"
            }

        # 找到CLI实际创建的outputs目录
        # CLI会创建类似 25303977_0_20260528_181425/outputs/ 的目录
        # 注意：只匹配目录，不匹配文件（如 25303977_0_eval_result.json）
        task_run_dirs = [d for d in self.run_dir.glob(f"{task_id}_*") if d.is_dir()]
        task_run_dirs = sorted(task_run_dirs, reverse=True)

        if not task_run_dirs:
            return {
                "passed": False,
                "error": f"No run directory found for {task_id}"
            }

        # 使用最新的运行目录
        latest_run_dir = task_run_dirs[0]
        actual_outputs_dir = latest_run_dir / "outputs"

        if not actual_outputs_dir.exists():
            return {
                "passed": False,
                "error": f"Outputs directory not found: {actual_outputs_dir}"
            }

        # 使用增量评测器
        evaluator_script = Path.cwd() / "incremental_evaluator.py"
        result_file = self.run_dir / f"{task_id}_eval_result.json"

        try:
            result = subprocess.run(
                [
                    "python3",  # 使用python3以支持numpy 2.x的pickle文件
                    str(evaluator_script),
                    "--task-dir", str(task_dir),
                    "--outputs-dir", str(actual_outputs_dir),
                    "--result", str(result_file)
                ],
                capture_output=True,
                text=True,
                timeout=300
            )

            # 读取评测结果
            if result_file.exists():
                with open(result_file, "r") as f:
                    eval_result = json.load(f)

                # 保存详细的评测输出（包括stdout/stderr，用于错误分析）
                detailed_result = {
                    "evaluation": eval_result,
                    "evaluator_stdout": result.stdout,
                    "evaluator_stderr": result.stderr,
                    "evaluator_returncode": result.returncode
                }

                detailed_result_file = self.run_dir / f"{task_id}_eval_detailed.json"
                with open(detailed_result_file, "w") as f:
                    json.dump(detailed_result, f, indent=2, ensure_ascii=False)

                if eval_result["status"] == "pass":
                    return {"passed": True, "details": eval_result}
                else:
                    return {
                        "passed": False,
                        "error": eval_result.get("feedback", "Evaluation failed"),
                        "details": eval_result
                    }
            else:
                return {
                    "passed": False,
                    "error": f"Evaluation result file not created. stdout: {result.stdout}, stderr: {result.stderr}"
                }

        except Exception as e:
            return {
                "passed": False,
                "error": str(e)
            }

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="母任务执行器")
    parser.add_argument("study_id", help="母任务ID")
    parser.add_argument("num_subtasks", type=int, help="子任务数量")
    parser.add_argument("--tasks-dir", default="tasks", help="任务目录")
    parser.add_argument("--runs-dir", default="output/Bio_runs", help="运行输出目录")
    parser.add_argument("--max-rounds", type=int, default=3, help="每个子任务最多重试次数")
    parser.add_argument("--timeout", type=int, default=7200, help="每个子任务超时时间（秒）")

    args = parser.parse_args()

    executor = StudyTaskExecutor(
        study_id=args.study_id,
        num_subtasks=args.num_subtasks,
        tasks_dir=args.tasks_dir,
        runs_dir=args.runs_dir,
        max_rounds_per_subtask=args.max_rounds,
        timeout_seconds=args.timeout
    )
    result = executor.execute()

    sys.exit(0 if result["status"] == "passed" else 1)
