#!/usr/bin/env python3
"""
增量评测器 - 为单个子任务创建自定义评测逻辑
每完成一个子任务就测评一次，支持pickle和CSV两种输出格式
"""

import os
import sys
import json
import pickle
import subprocess
from pathlib import Path
from typing import Any, Dict, Optional
import pandas as pd


class IncrementalEvaluator:
    """增量评测器 - 支持单个子任务的灵活评测"""
    
    def __init__(self, task_dir: Path, outputs_dir: Path):
        self.task_dir = Path(task_dir)
        self.outputs_dir = Path(outputs_dir)
        self.eval_dir = self.task_dir / "evaluation"
        self.workdir = self.task_dir / "workdir"
        
    def execute_ai_code(self, namespace: Dict[str, Any]) -> bool:
        """
        执行AI生成的Python代码（在workspace目录中）
        返回True表示成功执行，False表示需要回退到文件加载
        """
        # 查找AI生成的Python文件（在workspace目录）
        workspace_dir = self.outputs_dir.parent / "workspace"
        if not workspace_dir.exists():
            return False

        python_files = ['solver.py', 'solution.py', 'answer.py', 'main.py', 'code.py']

        for filename in python_files:
            code_path = workspace_dir / filename
            if code_path.exists():
                try:
                    print(f"  - 尝试执行 workspace/{filename}")
                    code = code_path.read_text(encoding="utf-8")

                    # 保存当前工作目录
                    import os
                    original_cwd = os.getcwd()

                    try:
                        # 切换到任务运行目录的根目录（这样public/workdir路径才能正确工作）
                        # workspace的父目录就是任务运行目录
                        task_run_dir = workspace_dir.parent
                        os.chdir(task_run_dir)

                        # 在相同的命名空间中执行（与test_cases共享）
                        exec(compile(code, str(code_path), "exec"), namespace)

                        print(f"  ✓ workspace/{filename} 执行成功")
                        return True
                    finally:
                        # 恢复原工作目录
                        os.chdir(original_cwd)

                except Exception as e:
                    print(f"  ⚠️  workspace/{filename} 执行失败: {type(e).__name__}: {str(e)[:100]}")
                    # 继续尝试下一个文件
                    continue

        return False

    def load_submission_outputs(self) -> Dict[str, Any]:
        """
        从outputs目录加载AI生成的输出
        支持五种格式：
        1. pickle文件 (*.pkl) - 优先
        2. JSON文件 (*.json) - 自动解析为字典
        3. CSV文件 (*.csv) - 自动加载为DataFrame
        4. TXT文件 (*.txt) - 加载为字符串或数值
        5. solution.py/answer.py/results.py - Python代码
        """
        namespace = {}

        # 方法1: 尝试加载pickle文件
        pkl_files = list(self.outputs_dir.glob("*.pkl"))
        if pkl_files:
            print(f"✓ 找到 {len(pkl_files)} 个pickle文件")
            for pkl_path in pkl_files:
                var_name = pkl_path.stem
                try:
                    with open(pkl_path, 'rb') as f:
                        data = pickle.load(f)
                    # 同时支持两种测试风格：
                    # 1) 直接使用文件名变量（如 results = {...}）
                    # 2) 直接使用字典展开后的键（如 n_msi = 18）
                    # 注意处理“文件名与字典键同名”的冲突场景。
                    if isinstance(data, dict):
                        dict_keys = [k for k in data.keys() if isinstance(k, str) and k.isidentifier()]
                        for k in dict_keys:
                            namespace[k] = data[k]
                        if var_name not in namespace:
                            namespace[var_name] = data
                        else:
                            namespace[f"{var_name}__obj"] = data
                        print(f"  - 加载 {var_name} from {pkl_path.name}（展开 {len(dict_keys)} 个字典键）")
                    else:
                        namespace[var_name] = data
                        print(f"  - 加载 {var_name} from {pkl_path.name}")
                except Exception as e:
                    print(f"  ✗ 加载 {pkl_path.name} 失败: {e}")
                    # 尝试加载同名的CSV文件作为备选
                    csv_fallback = pkl_path.with_suffix('.csv')
                    if csv_fallback.exists():
                        try:
                            namespace[var_name] = pd.read_csv(csv_fallback)
                            print(f"  ✓ 备选: 从 {csv_fallback.name} 加载成功")
                        except Exception as e2:
                            print(f"  ✗ CSV备选也失败: {e2}")

        # 方法2: 尝试加载JSON文件（如果还没有加载）
        json_files = list(self.outputs_dir.glob("*.json"))
        if json_files:
            print(f"✓ 找到 {len(json_files)} 个JSON文件")
            for json_path in json_files:
                var_name = json_path.stem
                # 跳过已经加载的变量
                if var_name in namespace:
                    continue
                try:
                    with open(json_path, 'r', encoding='utf-8') as f:
                        data = json.load(f)
                    # 与pickle加载保持一致，避免 var_name 与 dict key 冲突
                    if isinstance(data, dict):
                        dict_keys = [k for k in data.keys() if isinstance(k, str) and k.isidentifier()]
                        for k in dict_keys:
                            namespace[k] = data[k]
                        if var_name not in namespace:
                            namespace[var_name] = data
                        else:
                            namespace[f"{var_name}__obj"] = data
                        print(f"  - 加载 {var_name} from {json_path.name}（展开 {len(dict_keys)} 个字典键）")
                    else:
                        namespace[var_name] = data
                        print(f"  - 加载 {var_name} from {json_path.name}")
                except Exception as e:
                    print(f"  ✗ 加载 {json_path.name} 失败: {e}")

        # 方法3: 尝试加载CSV文件（如果还没有加载）
        csv_files = list(self.outputs_dir.glob("*.csv"))
        if csv_files:
            print(f"✓ 找到 {len(csv_files)} 个CSV文件")
            for csv_path in csv_files:
                var_name = csv_path.stem
                # 跳过已经加载的变量
                if var_name in namespace:
                    continue
                try:
                    namespace[var_name] = pd.read_csv(csv_path)
                    print(f"  - 加载 {var_name} from {csv_path.name}")
                except Exception as e:
                    print(f"  ✗ 加载 {csv_path.name} 失败: {e}")

        # 方法4: 尝试加载TXT文件（如果还没有加载）
        txt_files = list(self.outputs_dir.glob("*.txt"))
        if txt_files:
            print(f"✓ 找到 {len(txt_files)} 个TXT文件")
            for txt_path in txt_files:
                var_name = txt_path.stem
                # 跳过已经加载的变量
                if var_name in namespace:
                    continue
                try:
                    content = txt_path.read_text(encoding='utf-8').strip()
                    # 尝试转换为数值
                    try:
                        # 尝试整数
                        namespace[var_name] = int(content)
                        print(f"  - 加载 {var_name} from {txt_path.name} (as int)")
                    except ValueError:
                        try:
                            # 尝试浮点数
                            namespace[var_name] = float(content)
                            print(f"  - 加载 {var_name} from {txt_path.name} (as float)")
                        except ValueError:
                            # 保持为字符串
                            namespace[var_name] = content
                            print(f"  - 加载 {var_name} from {txt_path.name} (as string)")
                except Exception as e:
                    print(f"  ✗ 加载 {txt_path.name} 失败: {e}")

        # 方法5: 尝试执行Python文件
        for solution_file in ['solution.py', 'answer.py', 'results.py']:
            solution_path = self.outputs_dir / solution_file
            if solution_path.exists():
                print(f"✓ 找到 {solution_file}")
                try:
                    code = solution_path.read_text(encoding="utf-8")
                    exec(compile(code, str(solution_path), "exec"), namespace)
                    print(f"  - 执行 {solution_file} 成功")
                    break
                except Exception as e:
                    print(f"  ✗ 执行 {solution_file} 失败: {e}")

        return namespace
    
    def setup_workdir_redirect(self, namespace: Dict[str, Any]):
        """设置workdir路径重定向（与run_reference.py保持一致）"""
        import builtins
        
        def _redirect_workdir_path(path: Any) -> Any:
            if isinstance(path, os.PathLike):
                path = os.fspath(path)
            if isinstance(path, str):
                normalized = path.replace("\\", "/")
                if normalized == "/workdir":
                    return str(self.workdir)
                if normalized.startswith("/workdir/"):
                    return str(self.workdir / normalized[len("/workdir/"):])
                if normalized in ("./workdir", "workdir"):
                    return str(self.workdir)
                if normalized.startswith("./workdir/"):
                    return str(self.workdir / normalized[len("./workdir/"):])
                if normalized.startswith("workdir/"):
                    return str(self.workdir / normalized[len("workdir/"):])
            return path
        
        # Monkey patch pd.read_csv
        _real_read_csv = pd.read_csv
        def _read_csv_with_redirect(filepath_or_buffer: Any, *args, **kwargs) -> pd.DataFrame:
            return _real_read_csv(_redirect_workdir_path(filepath_or_buffer), *args, **kwargs)
        pd.read_csv = _read_csv_with_redirect
        
        # Monkey patch builtins.open
        _real_open = builtins.open
        def _open_with_redirect(file: Any, *args, **kwargs) -> Any:
            return _real_open(_redirect_workdir_path(file), *args, **kwargs)
        builtins.open = _open_with_redirect
    
    def preload_tables(self, namespace: Dict[str, Any]):
        """预加载task.json中定义的表格"""
        task_json_path = self.task_dir / "task.json"
        if not task_json_path.exists():
            return
        
        with task_json_path.open("r", encoding="utf-8") as f:
            metadata = json.load(f)
        
        table_bindings = metadata.get("table_bindings", [])
        for binding in table_bindings:
            csv_path = self.workdir / binding["output_file"]
            if not csv_path.exists():
                continue
            df = pd.read_csv(csv_path)
            names = {binding["variable_name"], Path(binding["output_file"]).stem}
            for name in names:
                if name and name.isidentifier():
                    namespace[name] = df.copy()
    
    def smart_alias_variables(self, namespace: Dict[str, Any], submission_vars: Dict[str, Any] = None):
        """
        智能变量名映射：
        从test_cases.py中提取需要的变量名，如果namespace中没有但有相似的对象，
        创建别名以匹配测试用例的期望

        Args:
            namespace: 完整命名空间
            submission_vars: AI提交的变量（用于区分预加载表 vs AI生成的）
        """
        import ast
        import re
        import difflib

        test_cases_path = self.eval_dir / "test_cases.py"
        reference_path = self.eval_dir / "reference_answer.py"

        if not test_cases_path.exists():
            return

        # 提取test_cases.py中引用的所有Name
        test_code = test_cases_path.read_text(encoding="utf-8")
        referenced_names = set()
        try:
            tree = ast.parse(test_code)
            for node in ast.walk(tree):
                if isinstance(node, ast.Name):
                    referenced_names.add(node.id)
                elif isinstance(node, ast.Attribute):
                    # 处理 df_exp.columns 这种
                    n = node
                    while isinstance(n, ast.Attribute):
                        n = n.value
                    if isinstance(n, ast.Name):
                        referenced_names.add(n.id)
                elif isinstance(node, ast.Subscript):
                    # 处理 df_exp["col"] 这种
                    n = node.value
                    if isinstance(n, ast.Name):
                        referenced_names.add(n.id)
        except SyntaxError:
            # 回退：正则提取
            referenced_names = set(re.findall(r'\b([a-zA-Z_][a-zA-Z0-9_]*)\b', test_code))

        # 找出测试用例需要但namespace里没有的变量
        # 排除Python builtins和常见库
        builtins_skip = {'assert', 'len', 'min', 'max', 'sum', 'list', 'dict', 'set',
                        'int', 'float', 'str', 'bool', 'tuple', 'range', 'print',
                        'import', 'pd', 'pandas', 'np', 'numpy', 'os', 'sys',
                        're', 'True', 'False', 'None', 'isinstance', 'type',
                        'enumerate', 'zip', 'sorted', 'abs', 'round', 'any', 'all'}
        missing_vars = {name for name in referenced_names
                       if name not in namespace
                       and name not in builtins_skip
                       and not name.startswith('_')}

        if not missing_vars:
            return

        print(f"  ⚠️  测试用例需要但未加载的变量: {missing_vars}")

        # 收集"可命名"的对象（优先AI生成的文件）
        candidate_objects = {}
        source = submission_vars if submission_vars else namespace
        for key, val in source.items():
            if key in builtins_skip or key.startswith('_'):
                continue
            if isinstance(val, (pd.DataFrame, dict, list)) or hasattr(val, '__module__'):
                candidate_objects[key] = val

        # 策略1: 如果missing_vars只有一个，且candidate_objects只有一个匹配的对象
        if len(missing_vars) == 1 and len(candidate_objects) >= 1:
            missing_var = next(iter(missing_vars))
            # 优先选择最可能匹配的：DataFrame
            df_candidates = {k: v for k, v in candidate_objects.items()
                            if isinstance(v, pd.DataFrame)}
            if len(df_candidates) == 1:
                src_name = next(iter(df_candidates))
                namespace[missing_var] = df_candidates[src_name]
                print(f"  ✓ 智能别名: {src_name} → {missing_var}")
                return

        # 策略2: 模糊匹配（使用编辑距离）
        for missing in missing_vars:
            # 尝试精确匹配
            if missing in candidate_objects:
                continue

            # 使用difflib进行模糊匹配（处理拼写相似的情况，如wide vs wild）
            matches = difflib.get_close_matches(missing, candidate_objects.keys(), n=1, cutoff=0.75)
            if matches:
                src_name = matches[0]
                namespace[missing] = candidate_objects[src_name]
                print(f"  ✓ 智能别名(模糊匹配): {src_name} → {missing}")
                continue

            # 策略3: 字符串包含关系
            for src_name, src_val in candidate_objects.items():
                # 简单字符串相似度
                if missing.lower() in src_name.lower() or src_name.lower() in missing.lower():
                    namespace[missing] = src_val
                    print(f"  ✓ 智能别名(相似): {src_name} → {missing}")
                    break

    def smart_column_mapping(self, namespace: Dict[str, Any]):
        """
        智能列名映射：处理DataFrame列名的单复数差异、大小写差异等
        """
        import re

        # 从test_cases.py中提取引用的列名
        test_cases_path = self.eval_dir / "test_cases.py"
        if not test_cases_path.exists():
            return

        test_code = test_cases_path.read_text(encoding="utf-8")

        # 提取所有字符串字面量（可能是列名）
        # 匹配 df["column"] 或 df['column'] 模式
        column_patterns = re.findall(r'["\']([^"\']+)["\']', test_code)
        expected_columns = set(column_patterns)

        # 对namespace中的所有DataFrame进行列名映射
        for var_name, var_value in namespace.items():
            if not isinstance(var_value, pd.DataFrame):
                continue

            actual_columns = set(var_value.columns)
            missing_columns = expected_columns - actual_columns

            if not missing_columns:
                continue

            # 尝试映射缺失的列
            column_mapping = {}

            for expected_col in missing_columns:
                # 策略1: 单复数转换
                # "# of Counts" <-> "# of Count"
                singular = expected_col.rstrip('s') if expected_col.endswith('s') else expected_col + 's'

                if singular in actual_columns:
                    column_mapping[singular] = expected_col
                    print(f"  ✓ 智能列名映射({var_name}): '{singular}' → '{expected_col}'")
                    continue

                # 策略2: 大小写不敏感匹配
                for actual_col in actual_columns:
                    if expected_col.lower() == actual_col.lower():
                        column_mapping[actual_col] = expected_col
                        print(f"  ✓ 智能列名映射({var_name}): '{actual_col}' → '{expected_col}' (大小写)")
                        break

            # 应用映射
            if column_mapping:
                namespace[var_name] = var_value.rename(columns=column_mapping)

    def run_test_cases(self, namespace: Dict[str, Any]) -> Dict[str, Any]:
        """执行test_cases.py"""
        test_cases_path = self.eval_dir / "test_cases.py"

        if not test_cases_path.exists():
            return {
                "status": "error",
                "reward": 0,
                "feedback": f"test_cases.py not found at {test_cases_path}"
            }

        # 添加常用库到namespace
        import pandas as pd
        import numpy as np
        namespace['pd'] = pd
        namespace['np'] = np

        try:
            # 执行prefix.py（如果存在）
            prefix_path = self.eval_dir / "prefix.py"
            if prefix_path.exists():
                code = prefix_path.read_text(encoding="utf-8")
                exec(compile(code, str(prefix_path), "exec"), namespace)

            # 执行test_cases.py
            code = test_cases_path.read_text(encoding="utf-8")
            exec(compile(code, str(test_cases_path), "exec"), namespace)

            return {
                "status": "pass",
                "reward": 1,
                "feedback": "All test cases passed"
            }

        except NameError as e:
            # 提取缺失的变量名
            import re
            match = re.search(r"name '(\w+)' is not defined", str(e))
            missing_var = match.group(1) if match else "unknown"

            # 列出可用的变量（排除内置和库）
            available_vars = [k for k in namespace.keys()
                             if not k.startswith('_')
                             and k not in {'pd', 'np', 'os', 'sys', 're', 'json', 'pickle', 'Path', 'pathlib'}
                             and (not callable(namespace[k]) or isinstance(namespace[k], type))]

            return {
                "status": "error",
                "reward": 0,
                "feedback": f"变量未定义: '{missing_var}'\n"
                           f"命名空间中可用的变量: {available_vars[:20]}\n"
                           f"提示: 请确保在全局作用域定义变量，或保存为与变量名匹配的文件"
            }

        except AssertionError as e:
            import traceback
            tb_list = traceback.extract_tb(e.__traceback__)
            tb_str = traceback.format_exc()

            assertion_line = None
            for frame in reversed(tb_list):
                if frame.filename == str(test_cases_path) and frame.line and 'assert' in frame.line:
                    assertion_line = frame.line.strip()
                    break
            if assertion_line is None:
                for frame in reversed(tb_list):
                    if frame.line and 'assert' in frame.line:
                        assertion_line = frame.line.strip()
                        break

            msg = str(e).strip()
            feedback = "Assertion failed"
            if assertion_line:
                feedback += f": {assertion_line}"
            if msg and "<traceback object" not in msg:
                feedback += f"\nMessage: {msg}"

            tb_lines = [line for line in tb_str.split('\n') if line.strip()]
            relevant_tb = '\n'.join(tb_lines[-10:])
            if relevant_tb:
                feedback += f"\n\nTraceback:\n{relevant_tb}"

            return {
                "status": "fail",
                "reward": 0,
                "feedback": feedback
            }

        except Exception as e:
            return {
                "status": "error",
                "reward": 0,
                "feedback": f"Error during test execution: {type(e).__name__}: {str(e)}"
            }
    
    def evaluate(self) -> Dict[str, Any]:
        """执行完整的评测流程"""
        print(f"\n{'='*60}")
        print(f"增量评测器 - 任务: {self.task_dir.name}")
        print(f"{'='*60}\n")

        # 1. 创建命名空间
        namespace = {
            "__name__": "__biodsbench_incremental__",
            "__file__": str(self.eval_dir / "test_cases.py"),
        }

        # 2. 设置环境
        self.setup_workdir_redirect(namespace)

        # 3. 预加载表格
        print("步骤1: 预加载数据表格")
        self.preload_tables(namespace)
        print(f"  - 命名空间中有 {len(namespace)} 个预加载对象\n")

        # 4. 执行AI的Python代码（新增！）
        print("步骤2: 执行AI生成的Python代码")
        code_executed = self.execute_ai_code(namespace)

        if code_executed:
            print(f"  - AI代码执行后，命名空间中有 {len(namespace)} 个对象\n")
        else:
            print(f"  - 未找到可执行的Python代码，将尝试加载输出文件\n")

        # 5. 加载AI输出文件（作为补充或备选）
        print("步骤3: 加载AI生成的输出文件")
        submission_vars = self.load_submission_outputs()

        if submission_vars:
            namespace.update(submission_vars)
            print(f"  - 从文件加载了 {len(submission_vars)} 个变量\n")
        elif not code_executed:
            return {
                "status": "error",
                "reward": 0,
                "feedback": "No outputs found: 既没有可执行的Python代码，也没有输出文件"
            }

        # 6. 智能变量名映射（处理文件名与测试用例期望变量名不匹配的情况）
        print("步骤4: 智能变量名映射")
        # 传入submission_vars作为候选，避免误匹配预加载表
        self.smart_alias_variables(namespace, submission_vars)
        print()

        # 7. 智能列名映射（处理DataFrame列名的单复数差异）
        print("步骤5: 智能列名映射")
        self.smart_column_mapping(namespace)
        print()

        # 8. 执行测试
        print("步骤6: 执行测试用例")
        result = self.run_test_cases(namespace)

        # 8. 输出结果
        print(f"\n{'='*60}")
        print(f"评测结果: {result['status'].upper()}")
        print(f"得分: {result['reward']}")
        print(f"反馈: {result['feedback']}")
        print(f"{'='*60}\n")

        return result


def main():
    """命令行入口"""
    import argparse
    
    parser = argparse.ArgumentParser(description="增量评测器 - 单个子任务评测")
    parser.add_argument("--task-dir", required=True, help="任务目录路径")
    parser.add_argument("--outputs-dir", required=True, help="AI输出目录路径")
    parser.add_argument("--result", required=True, help="结果JSON文件路径")
    
    args = parser.parse_args()
    
    evaluator = IncrementalEvaluator(
        task_dir=Path(args.task_dir),
        outputs_dir=Path(args.outputs_dir)
    )
    
    result = evaluator.evaluate()
    
    # 写入结果文件
    with open(args.result, 'w') as f:
        json.dump(result, f, indent=2)
    
    # 返回退出码
    sys.exit(0 if result['status'] == 'pass' else 1)


if __name__ == "__main__":
    main()
