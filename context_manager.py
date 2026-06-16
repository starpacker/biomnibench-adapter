#!/usr/bin/env python3
"""
上下文管理器：收集前面已完成子任务的输出文件和代码
用于构建后续子任务的执行上下文
"""
import json
from pathlib import Path
from typing import List, Dict, Optional

class ContextManager:
    def __init__(self, runs_dir: str = "output/Bio_runs"):
        self.runs_dir = Path(runs_dir)
    
    def get_completed_subtasks(self, study_id: str, current_index: int) -> List[Dict]:
        """
        获取当前子任务之前所有已完成的子任务信息
        
        Args:
            study_id: 母任务ID，如 "25303977"
            current_index: 当前子任务索引，如 3 (表示正在执行 25303977_3)
        
        Returns:
            已完成子任务列表，每个包含:
            - task_id: 子任务ID
            - output_files: 输出文件列表
            - code_file: 最终通过的代码文件路径
            - status: 状态 (passed/failed)
        """
        completed = []
        
        for i in range(current_index):
            task_id = f"{study_id}_{i}"
            task_info = self._get_task_info(task_id)
            if task_info:
                completed.append(task_info)
        
        return completed
    
    def _get_task_info(self, task_id: str) -> Optional[Dict]:
        """获取单个子任务的信息"""
        # 查找最新的运行目录
        pattern = f"{task_id}_incremental_*"
        matching_dirs = sorted(self.runs_dir.glob(pattern), reverse=True)
        
        if not matching_dirs:
            return None
        
        run_dir = matching_dirs[0]
        
        # 读取任务状态
        state_file = run_dir / "task_state.json"
        if not state_file.exists():
            return None
        
        with open(state_file) as f:
            state = json.load(f)
        
        if state.get("status") != "passed":
            return None
        
        # 收集输出文件
        outputs_dir = run_dir / "outputs"
        output_files = []
        if outputs_dir.exists():
            output_files = [str(f.relative_to(run_dir)) for f in outputs_dir.glob("*.pkl")]
        
        # 获取最终代码
        final_code = run_dir / "final_code.py"
        code_file = str(final_code.relative_to(run_dir)) if final_code.exists() else None
        
        return {
            "task_id": task_id,
            "run_dir": str(run_dir),
            "output_files": output_files,
            "code_file": code_file,
            "status": state.get("status"),
            "rounds": state.get("current_round", 0)
        }
    
    def build_context_prompt(self, study_id: str, current_index: int) -> str:
        """
        构建上下文提示，用于AI生成代码时参考
        
        Returns:
            包含前面所有已完成任务信息的提示文本
        """
        completed = self.get_completed_subtasks(study_id, current_index)
        
        if not completed:
            return "这是第一个子任务，没有前置依赖。"
        
        prompt_parts = [
            f"前面已完成 {len(completed)} 个子任务，你可以使用它们的输出和代码：\n"
        ]
        
        for task_info in completed:
            task_id = task_info["task_id"]
            prompt_parts.append(f"\n## {task_id}")
            prompt_parts.append(f"状态: {task_info['status']}")
            prompt_parts.append(f"轮次: {task_info['rounds']}")
            
            if task_info["output_files"]:
                prompt_parts.append(f"输出文件:")
                for output_file in task_info["output_files"]:
                    prompt_parts.append(f"  - {output_file}")
            
            if task_info["code_file"]:
                # 读取代码内容
                code_path = Path(task_info["run_dir"]) / task_info["code_file"]
                if code_path.exists():
                    with open(code_path) as f:
                        code_content = f.read()
                    prompt_parts.append(f"\n代码:\n```python\n{code_content}\n```")
        
        return "\n".join(prompt_parts)
    
    def get_output_files_paths(self, study_id: str, current_index: int) -> List[str]:
        """
        获取前面所有已完成任务的输出文件绝对路径
        用于设置 BIODSBENCH_OUTPUTS_DIR 环境变量
        """
        completed = self.get_completed_subtasks(study_id, current_index)
        all_outputs = []
        
        for task_info in completed:
            run_dir = Path(task_info["run_dir"])
            outputs_dir = run_dir / "outputs"
            if outputs_dir.exists():
                all_outputs.append(str(outputs_dir.absolute()))
        
        return all_outputs

if __name__ == "__main__":
    # 测试
    cm = ContextManager()
    
    # 假设 25303977_0 和 25303977_1 已完成
    print("测试: 获取 25303977_2 的上下文")
    context = cm.build_context_prompt("25303977", 2)
    print(context)
    
    print("\n" + "="*50)
    print("输出文件路径:")
    paths = cm.get_output_files_paths("25303977", 2)
    for p in paths:
        print(f"  - {p}")
