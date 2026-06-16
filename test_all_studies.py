#!/usr/bin/env python3
"""
测试BioDSBench的全部13个母任务
按顺序执行，遇到环境问题停止并修复
"""
import sys
import subprocess
from pathlib import Path
from datetime import datetime
import json

# 所有13个母任务ID
STUDY_IDS = [
    "25303977",
    "27959731",
    "28472509",
    "28481359",
    "28985567",
    "29713087",
    "30742119",
    "30867592",
    "32437664",
    "32864625",
    "33765338",
    "34819518",
    "37699004"
]

def run_study(study_id: str, output_dir: Path):
    """运行单个母任务"""
    print(f"\n{'='*70}")
    print(f"开始测试母任务: {study_id}")
    print(f"时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"{'='*70}\n")

    cmd = [
        "python3",
        "/home/yjh/my_claude/test_study_with_traces.py",
        "--study-id", study_id,
        "--output-dir", str(output_dir)
    ]

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=3600  # 1小时超时
        )

        if result.returncode != 0:
            print(f"\n❌ 母任务 {study_id} 执行失败!")
            print(f"返回码: {result.returncode}")
            print(f"\nSTDOUT:\n{result.stdout}")
            print(f"\nSTDERR:\n{result.stderr}")
            return False
        else:
            print(f"\n✅ 母任务 {study_id} 执行成功!")
            return True

    except subprocess.TimeoutExpired:
        print(f"\n⏰ 母任务 {study_id} 执行超时 (>1小时)")
        return False
    except Exception as e:
        print(f"\n❌ 母任务 {study_id} 执行异常: {e}")
        import traceback
        traceback.print_exc()
        return False

def main():
    output_dir = Path("/data/yjh/biodsbench-all-studies")
    output_dir.mkdir(parents=True, exist_ok=True)

    # 创建总结文件
    summary_file = output_dir / f"all_studies_summary_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"

    results = []
    total = len(STUDY_IDS)

    print(f"\n{'='*70}")
    print(f"BioDSBench 完整测评")
    print(f"{'='*70}")
    print(f"总母任务数: {total}")
    print(f"输出目录: {output_dir}")
    print(f"{'='*70}\n")

    for idx, study_id in enumerate(STUDY_IDS, 1):
        print(f"\n{'#'*70}")
        print(f"进度: [{idx}/{total}] 母任务 {study_id}")
        print(f"{'#'*70}")

        start_time = datetime.now()
        success = run_study(study_id, output_dir)
        end_time = datetime.now()
        duration = (end_time - start_time).total_seconds()

        result = {
            "study_id": study_id,
            "index": idx,
            "success": success,
            "start_time": start_time.isoformat(),
            "end_time": end_time.isoformat(),
            "duration_seconds": duration
        }
        results.append(result)

        # 保存进度
        with open(summary_file, "w") as f:
            json.dump({
                "total_studies": total,
                "completed": idx,
                "results": results
            }, f, indent=2)

        if not success:
            print(f"\n{'='*70}")
            print(f"⚠️  母任务 {study_id} 失败，停止测评")
            print(f"完成进度: {idx}/{total}")
            print(f"{'='*70}\n")

            # 保存最终总结
            summary = {
                "total_studies": total,
                "completed": idx,
                "succeeded": sum(1 for r in results if r["success"]),
                "failed": sum(1 for r in results if not r["success"]),
                "stopped_at": study_id,
                "results": results
            }
            with open(summary_file, "w") as f:
                json.dump(summary, f, indent=2)

            sys.exit(1)

        print(f"\n✅ 母任务 {study_id} 完成，用时 {duration:.1f}秒")
        print(f"累计进度: {idx}/{total}")

    # 全部完成
    print(f"\n{'='*70}")
    print(f"🎉 全部13个母任务测评完成!")
    print(f"{'='*70}\n")

    succeeded = sum(1 for r in results if r["success"])
    failed = sum(1 for r in results if not r["success"])

    summary = {
        "total_studies": total,
        "completed": total,
        "succeeded": succeeded,
        "failed": failed,
        "success_rate": succeeded / total,
        "results": results
    }

    with open(summary_file, "w") as f:
        json.dump(summary, f, indent=2)

    print(f"总结文件: {summary_file}")
    print(f"成功: {succeeded}/{total}")
    print(f"失败: {failed}/{total}")
    print(f"成功率: {succeeded/total*100:.1f}%")

    return 0 if failed == 0 else 1

if __name__ == "__main__":
    sys.exit(main())
