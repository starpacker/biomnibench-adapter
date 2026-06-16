#!/usr/bin/env python3
"""
使用 my_claude 测评 biomnibench-organized 中的所有任务
模型: claude-4.7-opus
Judge: qwen3.5-plus
"""
import sys
import os
import json
import subprocess
from pathlib import Path
from datetime import datetime
import time

def get_all_tasks(base_dir: Path):
    """获取所有任务目录"""
    tasks = []
    for task_dir in sorted(base_dir.iterdir()):
        if task_dir.is_dir() and task_dir.name.startswith("da-"):
            # 检查是否有必要的文件
            if (task_dir / "task.toml").exists():
                tasks.append(task_dir.name)
    return tasks

def run_task_with_bun(task_name: str, task_dir: Path, output_dir: Path):
    """使用 bun 运行单个任务"""
    
    print(f"\n{'='*70}")
    print(f"执行任务: {task_name}")
    print(f"任务目录: {task_dir}")
    print(f"{'='*70}\n")
    
    # 创建任务输出目录
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    run_dir = output_dir / f"{task_name}_{timestamp}"
    
    # 设置环境变量
    env = os.environ.copy()
    # Claude (Anthropic-compatible) 配置
    env['ANTHROPIC_API_KEY'] = "00gcclg9l39y9p01000dhjzolag1q2hk00901kh1"
    env['ANTHROPIC_BASE_URL'] = "https://api.gpugeek.com"
    env['API_KEY'] = "00gcclg9l39y9p01000dhjzolag1q2hk00901kh1"
    env['BASE_URL'] = "https://api.gpugeek.com"
    env['MODEL_NAME'] = "Vendor2/Claude-4.7-opus"
    # Qwen (LLM Judge) 配置 - 同样的 API key
    env['QWEN_MODEL'] = "Vendor3/qwen3.5-plus"
    env['QWEN_BASE_URL'] = "https://api.gpugeek.com/v1"
    env['QWEN_API_KEY'] = "00gcclg9l39y9p01000dhjzolag1q2hk00901kh1"
    
    # 构建 bun 命令 (tasksDir 指向任务父目录, task 是任务名)
    bun_path = "/home/yjh/.bun/bin/bun"
    cli_path = "/home/yjh/my_claude/src/harness/evaluation/cli.ts"
    
    cmd = [
        bun_path,
        cli_path,
        "--task", task_name,
        "--tasks-dir", str(task_dir.parent),
        "--runs-dir", str(output_dir),
        "--max-rounds", "5",
        "--timeout-seconds", "3600",
        "--temperature", "1",
        "--thinking", "disabled",
        "--timestamp", timestamp
    ]
    
    print(f"命令: {' '.join(cmd)}")
    print(f"输出目录: {run_dir}")
    print()
    
    start_time = time.time()
    
    try:
        # 运行任务
        result = subprocess.run(
            cmd,
            env=env,
            cwd="/home/yjh/my_claude",
            capture_output=True,
            text=True,
            timeout=3600
        )
        
        duration = time.time() - start_time
        
        # 保存输出
        log_file = output_dir / f"{task_name}_{timestamp}_output.log"
        with open(log_file, "w") as f:
            f.write(f"任务: {task_name}\n")
            f.write(f"开始时间: {datetime.now().isoformat()}\n")
            f.write(f"运行时长: {duration:.2f}秒\n")
            f.write(f"\n{'='*70}\n")
            f.write("STDOUT:\n")
            f.write(result.stdout)
            f.write(f"\n{'='*70}\n")
            f.write("STDERR:\n")
            f.write(result.stderr)
        
        # 检查结果
        success = result.returncode == 0
        
        # 运行 LLM Judge
        if success and run_dir.exists():
            judge_result = run_judge(task_name, task_dir, run_dir)
        else:
            judge_result = None
        
        status = "✅ 成功" if success else "❌ 失败"
        print(f"\n{status} {task_name}")
        print(f"运行时长: {duration:.2f}秒")
        print(f"返回码: {result.returncode}")
        if judge_result:
            print(f"评分: {judge_result.get('total_score', 0)}")
        
        return {
            "task_name": task_name,
            "status": "success" if success else "failed",
            "returncode": result.returncode,
            "duration": duration,
            "timestamp": timestamp,
            "run_dir": str(run_dir),
            "log_file": str(log_file),
            "judge_result": judge_result,
            "error": None
        }
        
    except subprocess.TimeoutExpired:
        duration = time.time() - start_time
        print(f"\n⏱️ 任务 {task_name} 超时 (>{3600}秒)")
        
        return {
            "task_name": task_name,
            "status": "timeout",
            "returncode": -1,
            "duration": duration,
            "timestamp": timestamp,
            "error": "任务执行超时"
        }
        
    except Exception as e:
        duration = time.time() - start_time
        print(f"\n❌ 任务 {task_name} 执行异常: {e}")
        import traceback
        traceback.print_exc()
        
        return {
            "task_name": task_name,
            "status": "error",
            "returncode": -1,
            "duration": duration,
            "timestamp": timestamp,
            "error": str(e)
        }

def run_judge(task_name: str, task_dir: Path, run_dir: Path):
    """运行 LLM Judge 评分"""
    
    print(f"\n🔍 运行 LLM Judge 评分...")
    
    # 查找 trace 和 answer 文件
    trace_file = None
    answer_file = None
    
    # 查找最新的运行目录
    workspace_dirs = list(run_dir.glob("workspace_*"))
    if workspace_dirs:
        latest_workspace = max(workspace_dirs, key=lambda p: p.stat().st_mtime)
        trace_file = latest_workspace / "trace.md"
        answer_file = latest_workspace / "answer.txt"
    
    if not trace_file or not trace_file.exists():
        print("⚠️  未找到 trace.md")
        return None
    
    if not answer_file or not answer_file.exists():
        print("⚠️  未找到 answer.txt")
        return None
    
    # 查找 rubric 文件
    rubric_file = task_dir / "evaluation" / "rubric.md"
    if not rubric_file.exists():
        print("⚠️  未找到 rubric.md")
        return None
    
    # 运行 judge
    judge_output = run_dir / "judge_result.json"
    
    env = os.environ.copy()
    env['QWEN_MODEL'] = "Vendor3/qwen3.5-plus"
    env['QWEN_BASE_URL'] = "https://api.gpugeek.com/v1"
    env['QWEN_API_KEY'] = "00gcclg9l39y9p01000dhjzolag1q2hk00901kh1"
    
    cmd = [
        "python3",
        "/home/yjh/my_claude/llm_judge_qwen.py",
        str(trace_file),
        str(answer_file),
        str(rubric_file),
        str(judge_output)
    ]
    
    try:
        result = subprocess.run(
            cmd,
            env=env,
            capture_output=True,
            text=True,
            timeout=300
        )
        
        if result.returncode == 0 and judge_output.exists():
            with open(judge_output) as f:
                judge_result = json.load(f)
            print(f"✅ Judge 评分完成: {judge_result.get('total_score', 0)}")
            return judge_result
        else:
            print(f"❌ Judge 失败: {result.stderr}")
            return None
            
    except Exception as e:
        print(f"❌ Judge 执行异常: {e}")
        return None

def main():
    base_dir = Path("/data/yjh/biomnibench-organized")
    output_dir = Path("/data/yjh/biomnibench-organized-results")
    output_dir.mkdir(parents=True, exist_ok=True)
    
    # 获取所有任务
    all_tasks = get_all_tasks(base_dir)
    
    print(f"\n{'='*70}")
    print(f"BioMniBench-Organized 任务测评")
    print(f"{'='*70}")
    print(f"模型: claude-4.7-opus")
    print(f"Judge: qwen3.5-plus")
    print(f"任务数量: {len(all_tasks)}")
    print(f"任务目录: {base_dir}")
    print(f"输出目录: {output_dir}")
    print(f"{'='*70}\n")
    
    print("任务列表:")
    for i, task_name in enumerate(all_tasks, 1):
        print(f"  {i:2d}. {task_name}")
    print()
    
    # 允许从指定任务开始
    start_from = None
    if len(sys.argv) > 1:
        start_from = sys.argv[1]
        print(f"从任务 {start_from} 开始运行\n")
    
    # 创建总结文件
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    summary_file = output_dir / f"summary_{timestamp}.json"
    
    results = []
    total = len(all_tasks)
    passed = 0
    failed = 0
    errors = 0
    
    # 开始运行任务
    skip = start_from is not None
    for idx, task_name in enumerate(all_tasks, 1):
        if skip:
            if task_name == start_from:
                skip = False
            else:
                print(f"跳过任务 {idx}/{total}: {task_name}")
                continue
        
        print(f"\n{'#'*70}")
        print(f"任务进度: {idx}/{total}")
        print(f"{'#'*70}")
        
        task_dir = base_dir / task_name
        result = run_task_with_bun(task_name, task_dir, output_dir)
        results.append(result)
        
        # 更新统计
        if result["status"] == "success":
            passed += 1
        elif result["status"] == "failed":
            failed += 1
        else:
            errors += 1
        
        # 保存中间结果
        with open(summary_file, "w") as f:
            json.dump({
                "timestamp": timestamp,
                "model": "claude-4.7-opus",
                "judge": "qwen3.5-plus",
                "total": total,
                "completed": idx,
                "passed": passed,
                "failed": failed,
                "errors": errors,
                "results": results
            }, f, indent=2)
        
        print(f"\n当前统计: 成功 {passed}, 失败 {failed}, 错误 {errors}")
        
        # 短暂休息，避免API限流
        if idx < total:
            print("等待 5 秒...")
            time.sleep(5)
    
    # 最终总结
    print(f"\n{'='*70}")
    print(f"测评完成！")
    print(f"{'='*70}")
    print(f"总任务数: {total}")
    print(f"成功: {passed}")
    print(f"失败: {failed}")
    print(f"错误: {errors}")
    print(f"成功率: {passed/total*100:.2f}%")
    print(f"\n结果保存在: {summary_file}")
    print(f"{'='*70}\n")

if __name__ == "__main__":
    main()
