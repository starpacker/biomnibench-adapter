import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { scanRunRoots } from './runScanner.js'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('scanRunRoots', () => {
  test('recursively indexes run summaries and first-line run context', async () => {
    const root = mkdtempSync(join(tmpdir(), 'skill-runs-'))
    roots.push(root)
    const logsDir = join(root, 'batch', 'task-a', 'run-1', 'logs')
    mkdirSync(logsDir, { recursive: true })
    const trajectoryPath = join(logsDir, 'trajectory.clean.jsonl')
    writeFileSync(
      trajectoryPath,
      [
        JSON.stringify({ kind: 'run_context', task_id: 'task-a', run_id: 'run-1' }),
        JSON.stringify({ kind: 'run_finished', status: 'success', reward: 1 }),
      ].join('\n') + '\n',
      'utf8',
    )
    writeFileSync(
      join(logsDir, 'run_summary.json'),
      JSON.stringify({ status: 'success', rounds: 3, reward: 1, trajectory_path: trajectoryPath }),
      'utf8',
    )

    const runs = await scanRunRoots([root])

    expect(runs).toHaveLength(1)
    expect(runs[0]).toMatchObject({
      runId: 'run-1',
      taskId: 'task-a',
      status: 'success',
      rounds: 3,
      reward: 1,
      logsDir,
      runDir: join(root, 'batch', 'task-a', 'run-1'),
      trajectoryPath,
      summaryPath: join(logsDir, 'run_summary.json'),
    })
  })

  test('does not follow trajectory_path outside the logs directory', async () => {
    const root = mkdtempSync(join(tmpdir(), 'skill-runs-unsafe-'))
    roots.push(root)
    const runDir = join(root, 'batch', 'task-a', 'run-1')
    const logsDir = join(runDir, 'logs')
    const outsideDir = join(root, 'outside')
    mkdirSync(logsDir, { recursive: true })
    mkdirSync(outsideDir, { recursive: true })
    const defaultTrajectoryPath = join(logsDir, 'trajectory.clean.jsonl')
    const outsideTrajectoryPath = join(outsideDir, 'trajectory.clean.jsonl')
    writeFileSync(
      defaultTrajectoryPath,
      JSON.stringify({ kind: 'run_context', task_id: 'safe-task', run_id: 'safe-run' }) + '\n',
      'utf8',
    )
    writeFileSync(
      outsideTrajectoryPath,
      JSON.stringify({ kind: 'run_context', task_id: 'leaked-task', run_id: 'leaked-run' }) + '\n',
      'utf8',
    )
    writeFileSync(
      join(logsDir, 'run_summary.json'),
      JSON.stringify({ status: 'success', rounds: 1, reward: 1, trajectory_path: outsideTrajectoryPath }),
      'utf8',
    )

    const runs = await scanRunRoots([root])

    expect(runs).toHaveLength(1)
    expect(runs[0]).toMatchObject({
      runId: 'safe-run',
      taskId: 'safe-task',
      trajectoryPath: defaultTrajectoryPath,
    })
  })

  test('does not follow relative traversal trajectory_path outside the logs directory', async () => {
    const root = mkdtempSync(join(tmpdir(), 'skill-runs-relative-'))
    roots.push(root)
    const runDir = join(root, 'batch', 'task-a', 'run-1')
    const logsDir = join(runDir, 'logs')
    mkdirSync(join(runDir, 'outside'), { recursive: true })
    mkdirSync(logsDir, { recursive: true })
    const defaultTrajectoryPath = join(logsDir, 'trajectory.clean.jsonl')
    writeFileSync(
      defaultTrajectoryPath,
      JSON.stringify({ kind: 'run_context', task_id: 'safe-task', run_id: 'safe-run' }) + '\n',
      'utf8',
    )
    writeFileSync(
      join(runDir, 'outside', 'trajectory.clean.jsonl'),
      JSON.stringify({ kind: 'run_context', task_id: 'leaked-task', run_id: 'leaked-run' }) + '\n',
      'utf8',
    )
    writeFileSync(
      join(logsDir, 'run_summary.json'),
      JSON.stringify({ status: 'success', rounds: 1, reward: 1, trajectory_path: '..\\outside\\trajectory.clean.jsonl' }),
      'utf8',
    )

    const runs = await scanRunRoots([root])

    expect(runs[0]).toMatchObject({
      runId: 'safe-run',
      taskId: 'safe-task',
      trajectoryPath: defaultTrajectoryPath,
    })
  })

  test('does not follow symlinked trajectory paths outside the logs directory', async () => {
    const root = mkdtempSync(join(tmpdir(), 'skill-runs-link-'))
    roots.push(root)
    const runDir = join(root, 'batch', 'task-a', 'run-1')
    const logsDir = join(runDir, 'logs')
    const outsideDir = join(root, 'outside')
    mkdirSync(logsDir, { recursive: true })
    mkdirSync(outsideDir, { recursive: true })
    const defaultTrajectoryPath = join(logsDir, 'trajectory.clean.jsonl')
    writeFileSync(
      defaultTrajectoryPath,
      JSON.stringify({ kind: 'run_context', task_id: 'safe-task', run_id: 'safe-run' }) + '\n',
      'utf8',
    )
    writeFileSync(
      join(outsideDir, 'trajectory.clean.jsonl'),
      JSON.stringify({ kind: 'run_context', task_id: 'leaked-task', run_id: 'leaked-run' }) + '\n',
      'utf8',
    )
    symlinkSync(outsideDir, join(logsDir, 'linked-outside'), 'junction')
    writeFileSync(
      join(logsDir, 'run_summary.json'),
      JSON.stringify({ status: 'success', rounds: 1, reward: 1, trajectory_path: 'linked-outside/trajectory.clean.jsonl' }),
      'utf8',
    )

    const runs = await scanRunRoots([root])

    expect(runs[0]).toMatchObject({
      runId: 'safe-run',
      taskId: 'safe-task',
      trajectoryPath: defaultTrajectoryPath,
    })
  })

  test('reports malformed first trajectory record with path and line number', async () => {
    const root = mkdtempSync(join(tmpdir(), 'skill-runs-bad-json-'))
    roots.push(root)
    const logsDir = join(root, 'batch', 'task-a', 'run-1', 'logs')
    mkdirSync(logsDir, { recursive: true })
    const trajectoryPath = join(logsDir, 'trajectory.clean.jsonl')
    writeFileSync(trajectoryPath, 'not-json\n', 'utf8')
    writeFileSync(join(logsDir, 'run_summary.json'), JSON.stringify({ trajectory_path: trajectoryPath }), 'utf8')

    await expect(scanRunRoots([root])).rejects.toThrow(`${trajectoryPath}:1`)
  })
})
