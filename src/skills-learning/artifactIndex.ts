import { lstat, readdir } from 'fs/promises'
import { isAbsolute, join, relative, resolve } from 'path'
import type { ArtifactIndex } from './types.js'

function isWithinDirectory(baseDir: string, candidatePath: string): boolean {
  const relativePath = relative(resolve(baseDir), resolve(candidatePath))
  return relativePath === '' || (!!relativePath && !relativePath.startsWith('..') && !isAbsolute(relativePath))
}

function resolveTaskDir(tasksDir: string, taskId: string): string {
  if (!taskId || isAbsolute(taskId) || taskId === '.' || taskId.includes('/') || taskId.includes('\\')) {
    throw new Error(`Unsafe taskId "${taskId}" escapes tasksDir`)
  }

  const tasksRoot = resolve(tasksDir)
  const taskDir = resolve(tasksRoot, taskId)
  if (!isWithinDirectory(tasksRoot, taskDir)) {
    throw new Error(`Unsafe taskId "${taskId}" escapes tasksDir`)
  }
  return taskDir
}

async function listExistingFiles(paths: string[], maxFiles = 500): Promise<string[]> {
  const files: string[] = []

  async function walk(path: string): Promise<void> {
    if (files.length >= maxFiles) return
    let info
    try {
      info = await lstat(path)
    } catch {
      return
    }
    if (info.isSymbolicLink()) return
    if (info.isFile()) {
      files.push(path)
      return
    }
    if (!info.isDirectory()) return

    for (const entry of await readdir(path, { withFileTypes: true })) {
      await walk(join(path, entry.name))
    }
  }

  for (const path of paths) await walk(path)
  return files.sort()
}

export async function indexArtifacts(
  runDir: string,
  tasksDir: string,
  taskId: string,
): Promise<ArtifactIndex> {
  const taskDir = resolveTaskDir(tasksDir, taskId)
  const publicDir = join(runDir, 'public')
  const workspaceDir = join(runDir, 'workspace')
  const outputsDir = join(runDir, 'outputs')
  const logsDir = join(runDir, 'logs')
  const stdCodeDir = join(taskDir, 'std_code')
  const evaluationDir = join(taskDir, 'evaluation')
  const metricsCandidates = [
    join(taskDir, 'metrics'),
    join(taskDir, 'metrics.json'),
    join(evaluationDir, 'metrics.json'),
    join(runDir, 'metrics'),
    join(runDir, 'metrics.json'),
  ]

  const publicFiles = await listExistingFiles([publicDir])
  const taskReadmes = await listExistingFiles([join(taskDir, 'README.md')])
  const evaluationFiles = await listExistingFiles([evaluationDir])
  const stdCodeFiles = await listExistingFiles([stdCodeDir])

  return {
    runDir,
    taskDir,
    paths: {
      public: publicFiles,
      workspace: await listExistingFiles([workspaceDir]),
      outputs: await listExistingFiles([outputsDir]),
      logs: await listExistingFiles([logsDir]),
      stdCode: stdCodeFiles,
      evaluation: evaluationFiles,
      metrics: await listExistingFiles(metricsCandidates),
      readmes: [...taskReadmes, ...publicFiles, ...stdCodeFiles, ...evaluationFiles].filter(path =>
        /README\.md$/i.test(path),
      ),
    },
  }
}
