#!/usr/bin/env python3
"""
Test BioDSBench judge mechanism with already-generated code
"""
import sys
from pathlib import Path

sys.path.insert(0, '/home/yjh/imaging-101')

from evaluation_harness.local_runner import LocalRunner
from evaluation_harness.biodsbench_judge import run_biodsbench_judge

# Test with task 25303977_0 using the already generated code
task_dir = Path('/home/yjh/BioDSBench-imaging101-format/tasks/25303977_0')

# Use the workspace where agent already generated code
# We'll use one of the completed test directories
workspace = Path('/data/yjh/biodsbench-test-results-fixed/25303977_20260607_021703/25303977_0')

print("=" * 70)
print("Testing BioDSBench Judge Mechanism")
print("=" * 70)
print(f"Task: {task_dir.name}")
print(f"Using workspace: {workspace}")
print()

# Check if workspace has the generated code
if not workspace.exists():
    print(f"❌ Workspace does not exist: {workspace}")
    sys.exit(1)

print("Files in workspace:")
for item in workspace.iterdir():
    print(f"  - {item.name}")
print()

# Create a LocalRunner pointing to this workspace
runner = LocalRunner(container=str(workspace))

# Check if test_cases.py exists
test_cases = task_dir / "evaluation" / "test_cases.py"
if not test_cases.exists():
    print(f"❌ test_cases.py not found: {test_cases}")
    sys.exit(1)

print(f"✅ Found test_cases.py")
print()

# Run the judge
print("Running BioDSBench judge...")
result = run_biodsbench_judge(runner, task_dir)

print()
print("=" * 70)
print("Judge Results")
print("=" * 70)

import json
print(json.dumps(result, indent=2))

if "error" in result:
    print()
    print("❌ Judge execution failed")
    sys.exit(1)

tests_total = result.get("tests_total", 0)
tests_passed = result.get("tests_passed", 0)
tests_failed = result.get("tests_failed", 0)

print()
print(f"Tests Total: {tests_total}")
print(f"Tests Passed: {tests_passed} ✅")
print(f"Tests Failed: {tests_failed} ❌")
print(f"Pass Rate: {tests_passed/tests_total*100:.1f}%" if tests_total > 0 else "N/A")

sys.exit(0 if tests_failed == 0 else 1)
