#!/usr/bin/env python3
"""
母任务执行器：执行单个母任务的所有子任务，子任务之间增量执行
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
                 max_rounds: int = 3,
                 timeout_seconds: int = 7200):
        self.study_id = study_id
        self.num_subtasks = num_subtasks
        self.tasks_dir = Path(tasks_dir)
        self.runs_dir = Path(runs_dir)
        self.max_rounds = max_rounds
        self.timeout_seconds = timeout_seconds
        
        # 创建运行目录
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        self.run_dir = self.runs_dir / f"{task_id}_incremental_{timestamp}"
        self.run_dir.mkdir(parents=True, exist_ok=True)
        
        # 输出目录
        self.outputs_dir = self.run_dir / "outputs"
        self.outputs_dir.mkdir(exist_ok=True)
        
        # 上下文管理器
        self.context_manager = ContextManager(runs_dir=str(self.runs_dir))
        
        # 任务状态
        self.state = {
            "task_id": task_id,
            "study_id": self.study_id,
            "task_index": self.task_index,
            "status": "not_started",
            "current_round": 0,
            "max_rounds": max_rounds,
            "rounds": [],
            "start_time": datetime.now().isoformat(),
            "end_time": None
        }
        self._save_state()
    
    def _save_state(self):
        """保存任务状态"""
        state_file = self.run_dir / "task_state.json"
        with open(state_file, "w") as f:
            json.dump(self.state, f, indent=2)
    
    def execute(self) -> Dict:
        """
        执行子任务，最多重试 max_rounds 次
        
        Returns:
            执行结果字典，包含 status, rounds, error 等信息
        """
        print(f"\n{'='*60}")
        print(f"开始执行子任务: {self.task_id}")
        print(f"运行目录: {self.run_dir}")
        print(f"最大轮次: {self.max_rounds}")
        print(f"{'='*60}\n")
        
        for round_num in range(1, self.max_rounds + 1):
            self.state["current_round"] = round_num
            self.state["status"] = "running"
            self._save_state()
            
            print(f"\n--- Round {round_num}/{self.max_rounds} ---")
            
            # 执行当前轮次
            result = self._execute_round(round_num)
            
            # 记录轮次结果
            self.state["rounds"].append(result)
            self._save_state()
            
            if result["status"] == "passed":
                print(f"✅ Round {round_num} 通过!")
                self.state["status"] = "passed"
                self.state["end_time"] = datetime.now().isoformat()
                self._save_state()
                
                # 保存最终代码
                self._save_final_code(round_num)
                return self.state
            
            elif result["status"] == "failed":
                print(f"❌ Round {round_num} 失败: {result.get('error', 'Unknown error')}")
                if round_num < self.max_rounds:
                    print(f"准备重试...")
                else:
                    print(f"已达到最大重试次数")
        
        # 所有轮次都失败
        self.state["status"] = "failed"
        self.state["end_time"] = datetime.now().isoformat()
        self._save_state()
        return self.state
    
    def _execute_round(self, round_num: int) -> Dict:
        """执行单个轮次"""
        round_dir = self.run_dir / f"round_{round_num}"
        round_dir.mkdir(exist_ok=True)
        
        result = {
            "round": round_num,
            "status": "failed",
            "start_time": datetime.now().isoformat(),
            "end_time": None,
            "error": None
        }
        
        try:
            # 1. 构建上下文
            print("1. 构建上下文...")
            context = self._build_context(round_num)
            
            # 2. 调用 CLI 执行任务
            print("2. 调用 BioDSBench CLI...")
            cli_result = self._run_cli(round_dir, context)
            
            if not cli_result["success"]:
                result["error"] = cli_result.get("error", "CLI execution failed")
                result["end_time"] = datetime.now().isoformat()
                return result
            
            # 3. 验证输出
            print("3. 验证输出...")
            validation_result = self._validate_output()
            
            if validation_result["passed"]:
                result["status"] = "passed"
            else:
                result["status"] = "failed"
                result["error"] = validation_result.get("error", "Validation failed")
            
        except Exception as e:
            result["error"] = str(e)
            print(f"执行出错: {e}")
        
        result["end_time"] = datetime.now().isoformat()
        return result
    
    def _build_context(self, round_num: int) -> str:
        """构建执行上下文"""
        # 获取前面已完成任务的上下文
        context = self.context_manager.build_context_prompt(
            self.study_id, 
            self.task_index
        )
        
        # 如果是重试，添加前一轮的错误信息
        if round_num > 1 and self.state["rounds"]:
            prev_round = self.state["rounds"][-1]
            if prev_round.get("error"):
                context += f"\n\n## 前一轮失败信息\n{prev_round['error']}"
        
        return context
    
    def _run_cli(self, round_dir: Path, context: str) -> Dict:
        """调用 BioDSBench CLI"""
        # 设置环境变量
        env = {
            **subprocess.os.environ.copy(),
            "BIODSBENCH_OUTPUTS_DIR": str(self.outputs_dir.absolute())
        }
        
        # 添加前面任务的输出目录到环境变量
        prev_outputs = self.context_manager.get_output_files_paths(
            self.study_id, 
            self.task_index
        )
        if prev_outputs:
            env["BIODSBENCH_PREV_OUTPUTS"] = ":".join(prev_outputs)
        
        # 构建命令
        cmd = [
            "bun",
            "src/harness/evaluation/cli.ts",
            "--task", self.task_id,
            "--tasks-dir", str(self.tasks_dir),
            "--runs-dir", str(self.runs_dir),
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
            
            # 保存日志
            log_file = round_dir / "cli_output.log"
            with open(log_file, "w") as f:
                f.write(f"Command: {' '.join(cmd)}\n")
                f.write(f"Exit code: {result.returncode}\n\n")
                f.write("STDOUT:\n")
                f.write(result.stdout)
                f.write("\n\nSTDERR:\n")
                f.write(result.stderr)
            
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
    
    def _validate_output(self) -> Dict:
        """验证输出文件"""
        # 调用 judge
        judge_script = self.tasks_dir / self.task_id / "evaluation" / "judge.py"
        
        if not judge_script.exists():
            return {
                "passed": False,
                "error": f"Judge script not found: {judge_script}"
            }
        
        env = {
            **subprocess.os.environ.copy(),
            "BIODSBENCH_OUTPUTS_DIR": str(self.outputs_dir.absolute())
        }
        
        try:
            result = subprocess.run(
                ["python", str(judge_script)],
                cwd=str(self.tasks_dir / self.task_id / "evaluation"),
                env=env,
                capture_output=True,
                text=True,
                timeout=300
            )
            
            if result.returncode == 0:
                return {"passed": True}
            else:
                return {
                    "passed": False,
                    "error": result.stderr or result.stdout
                }
        
        except Exception as e:
            return {
                "passed": False,
                "error": str(e)
            }
    
    def _save_final_code(self, round_num: int):
        """保存最终通过的代码"""
        # 从最新的运行目录中找到生成的代码
        # 这里需要根据实际的 CLI 输出结构调整
        round_dir = self.run_dir / f"round_{round_num}"
        
        # 假设代码在 workspace 目录下
        # 实际路径需要根据 CLI 的输出结构调整
        pass

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python subtask_executor.py <task_id>")
        sys.exit(1)
    
    task_id = sys.argv[1]
    executor = SubtaskExecutor(task_id)
    result = executor.execute()
    
    print(f"\n{'='*60}")
    print(f"执行完成: {task_id}")
    print(f"状态: {result['status']}")
    print(f"轮次: {result['current_round']}/{result['max_rounds']}")
    print(f"{'='*60}\n")
    
    sys.exit(0 if result["status"] == "passed" else 1)
