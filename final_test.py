#!/usr/bin/env python3
import sys
from pathlib import Path

sys.path.insert(0, '/home/yjh/imaging-101')

from evaluation_harness.config import LLMConfig, RunConfig, TaskConfig
from evaluation_harness.runner import BenchmarkRunner

task_dir = Path('/home/yjh/BioDSBench-imaging101-format/tasks/25303977_0')

# 验证test_cases.py存在
test_cases = task_dir / 'evaluation' / 'test_cases.py'
print(f'test_cases.py exists: {test_cases.exists()}')
print(f'Path: {test_cases}')
print()

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

output_dir = Path('/tmp/biodsbench-final-test')
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

print('Starting test...')
runner = BenchmarkRunner(run_config)
result = runner.run()

print()
print('='*70)
print('FINAL RESULTS:')
print('='*70)
print(f'Status: {result.stopped_reason}')
print(f'Iterations: {result.iterations}')
print(f'Total Tokens: {result.total_tokens}')
print()
print(f'Tests Total: {result.tests_total}')
print(f'Tests Passed: {result.tests_passed}')
print(f'Tests Failed: {result.tests_failed}')
print(f'Pass Rate: {result.test_pass_rate*100:.1f}%' if result.tests_total > 0 else 'N/A')
print()
print(f'Quality Metrics: {result.quality_metrics}')
print()

if result.test_details:
    print('Test Details:')
    for d in result.test_details[:10]:
        print(f"  [{d.get('status')}] {d.get('assertion', '')[:60]}")
        if d.get('error'):
            print(f"    Error: {d['error']}")
print('='*70)
