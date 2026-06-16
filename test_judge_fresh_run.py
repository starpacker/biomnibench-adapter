#!/usr/bin/env python3
"""
Test BioDSBench judge with a fresh run of task 25303977_0
"""
import sys
from pathlib import Path

sys.path.insert(0, '/home/yjh/imaging-101')

from evaluation_harness.config import LLMConfig, RunConfig, TaskConfig
from evaluation_harness.runner import BenchmarkRunner

task_dir = Path('/home/yjh/BioDSBench-imaging101-format/tasks/25303977_0')

llm_config = LLMConfig(
    model='Vendor2/Claude-4.7-opus',
    base_url='https://api.gpugeek.com/v1',
    api_key='00gcclg9l39y9p01000dhjzolag1q2hk00901kh1'
)

task_config = TaskConfig(
    task_name='25303977_0',
    task_dir=task_dir,
    mode='end_to_end',
    target_function=None
)

output_dir = Path('/tmp/biodsbench-judge-test')
output_dir.mkdir(parents=True, exist_ok=True)

run_config = RunConfig(
    llm=llm_config,
    task=task_config,
    max_iterations=20,
    docker_image=None,
    timeout_seconds=600,
    output_dir=output_dir,
    log_file=output_dir / 'test.log'
)

print("=" * 70)
print("Testing BioDSBench Judge with Task 25303977_0")
print("=" * 70)
print(f"Task: {task_config.task_name}")
print(f"Output: {output_dir}")
print()
print("This will run the agent and test the new judge mechanism.")
print()

runner = BenchmarkRunner(run_config)
result = runner.run()

print()
print("=" * 70)
print("Evaluation Results")
print("=" * 70)
print(f"Status: {result.stopped_reason}")
print(f"Iterations: {result.iterations}")
print(f"Total Tokens: {result.total_tokens}")
print(f"Wall Time: {result.wall_time_seconds:.1f}s")
print()
print(f"Tests Total: {result.tests_total}")
print(f"Tests Passed: {result.tests_passed} ✅")
print(f"Tests Failed: {result.tests_failed} ❌")

if result.tests_total > 0:
    print(f"Pass Rate: {result.test_pass_rate * 100:.1f}%")

    print()
    print("Test Details:")
    for detail in result.test_details[:10]:  # Show first 10
        status_icon = "✅" if detail.get("status") == "PASSED" else "❌"
        print(f"  {status_icon} {detail.get('test', 'unknown')}: {detail.get('assertion', '')[:60]}")
        if detail.get("error"):
            print(f"      Error: {detail['error']}")

if result.quality_metrics:
    print()
    print(f"Quality Metrics: {result.quality_metrics}")

print()
print(f"Results saved to: {output_dir}")
print("=" * 70)

sys.exit(0 if result.tests_failed == 0 else 1)
