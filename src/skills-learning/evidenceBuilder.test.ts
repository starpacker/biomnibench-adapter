import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { indexArtifacts } from './artifactIndex.js'
import { buildEvidencePackages } from './evidenceBuilder.js'
import type { RunIndexEntry, TrajectoryRecord } from './types.js'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function run(id: string, status: string, runDir: string): RunIndexEntry {
  return {
    runId: id,
    taskId: 'task-a',
    status,
    rounds: 1,
    reward: status === 'success' ? 1 : 0,
    runDir,
    logsDir: join(runDir, 'logs'),
    trajectoryPath: join(runDir, 'logs', 'trajectory.clean.jsonl'),
    summaryPath: join(runDir, 'logs', 'run_summary.json'),
  }
}

function records(status: string, text?: string): TrajectoryRecord[] {
  return [
    { kind: 'assistant_text', round: 1, text: text ?? (status === 'success' ? 'solved it' : 'tried random reshape') },
    { kind: 'tool_call', round: 1, tool: 'Bash', tool_use_id: 't1', input: { cmd: 'python solve.py' } },
    { kind: 'tool_result', round: 1, tool_use_id: 't1', ok: status === 'success', text: status },
    { kind: 'judge_result', round: 1, status, reward: status === 'success' ? 1 : 0, feedback: { status } },
  ]
}

describe('evidence packages', () => {
  test('builds success, success-vs-failure, and failure-vs-std-code evidence without standalone failure-only evidence', async () => {
    const root = mkdtempSync(join(tmpdir(), 'evidence-'))
    roots.push(root)
    const tasksDir = join(root, 'tasks')
    const taskDir = join(tasksDir, 'task-a')
    mkdirSync(join(taskDir, 'std_code'), { recursive: true })
    mkdirSync(join(taskDir, 'evaluation'), { recursive: true })
    const successRun = run('success-run', 'success', join(root, 'runs', 'success-run'))
    const failureRun = run('failure-run', 'failed', join(root, 'runs', 'failure-run'))
    mkdirSync(join(successRun.runDir, 'public'), { recursive: true })
    mkdirSync(join(successRun.runDir, 'outputs'), { recursive: true })
    mkdirSync(join(failureRun.runDir, 'logs'), { recursive: true })
    writeFileSync(join(successRun.runDir, 'public', 'README.md'), 'Task instructions', 'utf8')
    writeFileSync(join(taskDir, 'std_code', 'solve.py'), 'print("reference")', 'utf8')
    writeFileSync(join(taskDir, 'std_code', 'large.npz'), 'do-not-read', 'utf8')
    writeFileSync(join(taskDir, 'evaluation', 'metrics.json'), '{"metric":"ok"}', 'utf8')

    writeFileSync(join(successRun.runDir, 'outputs', 'answer.npz'), 'binary', 'utf8')
    writeFileSync(join(failureRun.runDir, 'logs', 'run_summary.json'), '{}', 'utf8')

    const successArtifacts = await indexArtifacts(successRun.runDir, tasksDir, 'task-a')
    const failureArtifacts = await indexArtifacts(failureRun.runDir, tasksDir, 'task-a')
    const packages = buildEvidencePackages({
      taskId: 'task-a',
      successes: [{ run: successRun, records: records('success'), artifacts: successArtifacts }],
      failures: [{ run: failureRun, records: records('failed'), artifacts: failureArtifacts }],
    })

    expect(packages.map(pkg => pkg.kind).sort()).toEqual([
      'failure-vs-std-code',
      'success',
      'success-vs-failure',
    ])
    const success = packages.find(pkg => pkg.kind === 'success')!
    expect(success.taskId).toBe('task-a')
    expect(success.runIds).toEqual(['success-run'])
    expect(success.roundSummaries[0].assistantText).toContain('solved it')
    expect(success.toolUsage[0]).toMatchObject({ tool: 'Bash', count: 1 })
    expect(success.judgeOutcomes[0]).toMatchObject({ runId: 'success-run', status: 'success', reward: 1 })
    expect(success.artifactPaths.some(path => path.endsWith('public/README.md'))).toBe(true)
    expect(success.artifactPaths.some(path => path.endsWith('outputs/answer.npz'))).toBe(true)

    const std = packages.find(pkg => pkg.kind === 'failure-vs-std-code')!
    expect(std.runIds).toEqual(['failure-run'])
    expect(std.artifactPaths.some(path => path.endsWith('std_code/solve.py'))).toBe(true)
    expect(std.artifactPaths.some(path => path.endsWith('std_code/large.npz'))).toBe(true)
  })

  test('does not build standalone failure-only evidence when std_code comparison is unavailable', async () => {
    const root = mkdtempSync(join(tmpdir(), 'evidence-no-standalone-failure-'))
    roots.push(root)
    const tasksDir = join(root, 'tasks')
    const taskDir = join(tasksDir, 'task-a')
    mkdirSync(taskDir, { recursive: true })
    const failureRun = run('failure-run', 'failed', join(root, 'runs', 'failure-run'))
    mkdirSync(join(failureRun.runDir, 'logs'), { recursive: true })
    writeFileSync(join(failureRun.runDir, 'logs', 'run_summary.json'), '{}', 'utf8')

    const failureArtifacts = await indexArtifacts(failureRun.runDir, tasksDir, 'task-a')
    const packages = buildEvidencePackages({
      taskId: 'task-a',
      successes: [],
      failures: [{ run: failureRun, records: records('failed'), artifacts: failureArtifacts }],
    })

    expect(packages).toEqual([])
  })

  test('aggregates all success and failure runs instead of only the first run', async () => {
    const root = mkdtempSync(join(tmpdir(), 'evidence-many-'))
    roots.push(root)
    const tasksDir = join(root, 'tasks')
    const taskDir = join(tasksDir, 'task-a')
    mkdirSync(join(taskDir, 'std_code'), { recursive: true })
    writeFileSync(join(taskDir, 'std_code', 'solve.py'), 'print("reference")', 'utf8')

    const successOne = run('success-one', 'success', join(root, 'runs', 'success-one'))
    const successTwo = run('success-two', 'success', join(root, 'runs', 'success-two'))
    const failureOne = run('failure-one', 'failed', join(root, 'runs', 'failure-one'))
    const failureTwo = run('failure-two', 'failed', join(root, 'runs', 'failure-two'))

    const artifacts = await indexArtifacts(failureOne.runDir, tasksDir, 'task-a')
    const packages = buildEvidencePackages({
      taskId: 'task-a',
      successes: [
        { run: successOne, records: records('success', 'first success'), artifacts },
        { run: successTwo, records: records('success', 'second success'), artifacts },
      ],
      failures: [
        { run: failureOne, records: records('failed', 'first failure'), artifacts },
        { run: failureTwo, records: records('failed', 'second failure'), artifacts },
      ],
    })

    expect(packages.find(pkg => pkg.kind === 'success')?.runIds).toEqual([
      'success-one',
      'success-two',
    ])
    expect(packages.find(pkg => pkg.kind === 'success-vs-failure')?.runIds).toEqual([
      'success-one',
      'success-two',
      'failure-one',
      'failure-two',
    ])
    expect(packages.find(pkg => pkg.kind === 'failure-vs-std-code')?.runIds).toEqual([
      'failure-one',
      'failure-two',
    ])
    const comparison = packages.find(pkg => pkg.kind === 'success-vs-failure')!
    expect(comparison.roundSummaries.map(round => round.assistantText).sort()).toEqual([
      'first failure',
      'first success',
      'second failure',
      'second success',
    ])
    expect(comparison.judgeOutcomes).toHaveLength(4)
    expect(comparison.toolUsage.find(tool => tool.tool === 'Bash')).toMatchObject({ count: 4 })
    expect(packages.find(pkg => pkg.kind === 'failure-vs-std-code')?.roundSummaries.map(round => round.runId).sort()).toEqual([
      'failure-one',
      'failure-two',
    ])
    expect(packages.some(pkg => String(pkg.kind) === 'failure-only')).toBe(false)
  })

  test('rejects task ids that escape the configured tasks directory', async () => {
    const root = mkdtempSync(join(tmpdir(), 'evidence-escape-'))
    roots.push(root)
    const tasksDir = join(root, 'tasks')
    const runDir = join(root, 'runs', 'run-1')
    mkdirSync(tasksDir, { recursive: true })

    await expect(indexArtifacts(runDir, tasksDir, '..')).rejects.toThrow('Unsafe taskId')
  })

  test('rejects task ids with path separators or dot segments', async () => {
    const root = mkdtempSync(join(tmpdir(), 'evidence-taskid-'))
    roots.push(root)
    const tasksDir = join(root, 'tasks')
    const runDir = join(root, 'runs', 'run-1')
    mkdirSync(tasksDir, { recursive: true })

    for (const taskId of ['.', 'task-a/..', 'task-a/../task-b', 'task-a\\..\\task-b', 'task-a/task-b']) {
      await expect(indexArtifacts(runDir, tasksDir, taskId)).rejects.toThrow('Unsafe taskId')
    }
  })

  test('does not follow symlinked artifact directories outside a run', async () => {
    const root = mkdtempSync(join(tmpdir(), 'evidence-link-'))
    roots.push(root)
    const tasksDir = join(root, 'tasks')
    const runDir = join(root, 'runs', 'run-1')
    const outsideDir = join(root, 'outside')
    mkdirSync(join(runDir, 'workspace'), { recursive: true })
    mkdirSync(join(tasksDir, 'task-a'), { recursive: true })
    mkdirSync(outsideDir, { recursive: true })
    writeFileSync(join(outsideDir, 'secret.txt'), 'outside', 'utf8')
    symlinkSync(outsideDir, join(runDir, 'workspace', 'linked-outside'), 'junction')

    const artifacts = await indexArtifacts(runDir, tasksDir, 'task-a')

    expect(artifacts.paths.workspace.some(path => path.endsWith('secret.txt'))).toBe(false)
    expect(artifacts.paths.workspace.some(path => path.includes('linked-outside'))).toBe(false)
  })
})
