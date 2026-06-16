import { createReadStream } from 'fs'
import { realpath, readdir, readFile, stat } from 'fs/promises'
import { createInterface } from 'readline'
import { dirname, isAbsolute, join, relative, resolve } from 'path'
import type { RunIndexEntry, TrajectoryRecord } from './types.js'

function isWithinDirectory(baseDir: string, candidatePath: string): boolean {
  const relativePath = relative(resolve(baseDir), resolve(candidatePath))
  return relativePath === '' || (!!relativePath && !relativePath.startsWith('..') && !isAbsolute(relativePath))
}

async function findSummaries(dir: string): Promise<string[]> {
  const found: string[] = []
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return found
  }

  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'logs') {
        const summary = join(path, 'run_summary.json')
        try {
          if ((await stat(summary)).isFile()) found.push(summary)
        } catch {
          // Not every logs directory is a run logs directory.
        }
      }
      found.push(...(await findSummaries(path)))
    }
  }

  return found
}

async function readFirstRecord(path: string): Promise<TrajectoryRecord | undefined> {
  const stream = createReadStream(path, { encoding: 'utf8' })
  const lines = createInterface({ input: stream, crlfDelay: Infinity })
  let lineNumber = 0
  try {
    for await (const rawLine of lines) {
      lineNumber += 1
      const line = rawLine.trim()
      if (!line) continue
      try {
        return JSON.parse(line)
      } catch (error) {
        throw new Error(`${path}:${lineNumber}: invalid JSON: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    return undefined
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return undefined
    if (error instanceof Error && /ENOENT/.test(error.message)) return undefined
    throw error
  } finally {
    lines.close()
    stream.destroy()
  }
}

async function isWithinRealDirectory(baseDir: string, candidatePath: string): Promise<boolean> {
  try {
    const [baseReal, candidateReal] = await Promise.all([realpath(baseDir), realpath(candidatePath)])
    return isWithinDirectory(baseReal, candidateReal)
  } catch {
    return false
  }
}

async function resolveTrajectoryPath(logsDir: string, rawPath: unknown): Promise<string> {
  const defaultPath = resolve(logsDir, 'trajectory.clean.jsonl')
  if (typeof rawPath !== 'string') return defaultPath

  const candidate = isAbsolute(rawPath) ? resolve(rawPath) : resolve(logsDir, rawPath)
  if (!isWithinDirectory(logsDir, candidate)) return defaultPath
  return (await isWithinRealDirectory(logsDir, candidate)) ? candidate : defaultPath
}

export async function scanRunRoots(runRoots: string[]): Promise<RunIndexEntry[]> {
  const summaries = (await Promise.all(runRoots.map(findSummaries))).flat()
  const runs: RunIndexEntry[] = []

  for (const summaryPath of summaries.sort()) {
    const logsDir = dirname(summaryPath)
    const runDir = dirname(logsDir)
    const summary = JSON.parse(await readFile(summaryPath, 'utf8'))
    const trajectoryPath = await resolveTrajectoryPath(logsDir, summary.trajectory_path)
    const context = await readFirstRecord(trajectoryPath)

    runs.push({
      runId:
        typeof context?.run_id === 'string'
          ? context.run_id
          : typeof summary.run_id === 'string'
            ? summary.run_id
            : runDir.split(/[\\/]/).pop() ?? 'unknown',
      taskId:
        typeof context?.task_id === 'string'
          ? context.task_id
          : typeof summary.task_id === 'string'
            ? summary.task_id
            : 'unknown',
      status: typeof summary.status === 'string' ? summary.status : 'unknown',
      rounds: typeof summary.rounds === 'number' ? summary.rounds : 0,
      reward: typeof summary.reward === 'number' ? summary.reward : 0,
      runDir,
      logsDir,
      trajectoryPath,
      summaryPath,
    })
  }

  return runs
}
