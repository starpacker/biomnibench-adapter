#!/usr/bin/env python3
"""
将所有BioDSBench任务的详细输出格式说明替换为简洁版本
"""
import sys
import re
from pathlib import Path
from collections import Counter

def get_variable_name(task_dir: Path) -> str:
    """从test_cases.py提取变量名"""
    test_cases = task_dir / "evaluation" / "test_cases.py"
    if not test_cases.exists():
        return None

    test_code = test_cases.read_text()

    # 提取变量名
    pattern1 = r'assert\s+(\w+)\.'
    pattern2 = r'assert\s+(\w+)\['
    pattern3 = r'assert\s+abs\((\w+)\['

    matches = []
    matches.extend(re.findall(pattern1, test_code))
    matches.extend(re.findall(pattern2, test_code))
    matches.extend(re.findall(pattern3, test_code))

    if not matches:
        return None

    variable_counts = Counter(matches)
    return variable_counts.most_common(1)[0][0] if variable_counts else None


def simplify_readme(task_dir: Path, dry_run: bool = True) -> bool:
    """简化README的输出格式说明"""

    readme_path = task_dir / "README.md"
    if not readme_path.exists():
        return False

    content = readme_path.read_text()

    # 检查是否有详细的格式说明
    if "## IMPORTANT: Output Format Requirements for Evaluation" not in content:
        return False

    # 获取变量名
    var_name = get_variable_name(task_dir)
    if not var_name:
        print(f"  ⚠️  无法获取变量名")
        return False

    # 移除详细说明（从"## IMPORTANT"到下一个"---"之前）
    pattern = r'## IMPORTANT: Output Format Requirements for Evaluation.*?(?=---|\Z)'
    new_content = re.sub(pattern, '', content, flags=re.DOTALL)

    # 确保有分隔线
    if "---\n**IMPORTANT: Save results to CSV" not in new_content:
        # 如果没有简洁版，添加
        simple_instruction = f"""
---
**IMPORTANT: Save results to CSV for evaluation**
```python
{var_name}.to_csv("output/{var_name}.csv", index=True)
```
"""
        new_content = new_content.rstrip() + simple_instruction

    if dry_run:
        old_len = len(content)
        new_len = len(new_content)
        print(f"  📝 会简化 {old_len} → {new_len} 字符 (减少 {old_len - new_len})")
        return True
    else:
        readme_path.write_text(new_content)
        print(f"  ✅ 已简化")
        return True


def main():
    import argparse

    parser = argparse.ArgumentParser(description="简化BioDSBench输出格式说明")
    parser.add_argument("--tasks-dir", default="/home/yjh/BioDSBench-imaging101-format/tasks")
    parser.add_argument("--write", action="store_true", help="实际写入更改")

    args = parser.parse_args()

    tasks_dir = Path(args.tasks_dir)
    dry_run = not args.write

    print("=" * 80)
    print("BioDSBench 输出格式简化")
    print("=" * 80)
    print()
    print(f"模式: {'DRY RUN' if dry_run else 'WRITE'}")
    print()

    task_dirs = sorted([d for d in tasks_dir.iterdir() if d.is_dir()])
    modified = 0

    for task_dir in task_dirs:
        print(f"任务: {task_dir.name}")

        test_cases = task_dir / "evaluation" / "test_cases.py"
        if not test_cases.exists():
            print(f"  ⚠️  不是BioDSBench任务")
            print()
            continue

        if simplify_readme(task_dir, dry_run):
            modified += 1

        print()

    print("=" * 80)
    print(f"总结: {modified}/{len(task_dirs)} 任务{'将被' if dry_run else '已被'}简化")
    print("=" * 80)


if __name__ == "__main__":
    main()
