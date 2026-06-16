import { existsSync, realpathSync } from 'fs'
import { basename, dirname, isAbsolute, relative, resolve } from 'path'
import type { SkillLearningConfig } from '../config.js'

export type ToolPolicyDecision = {
  allowed: boolean
  resolvedPath: string
  reason?: string
}

export type LearningToolPolicy = {
  canRead(path: string): ToolPolicyDecision
  canWrite(path: string): ToolPolicyDecision
}

export type LearningToolPolicyOptions = {
  allowStdCodeReads?: boolean
}

function isWithinDirectory(baseDir: string, candidatePath: string): boolean {
  const relativePath = relative(resolve(baseDir), resolve(candidatePath))
  return relativePath === '' || (!!relativePath && !relativePath.startsWith('..') && !isAbsolute(relativePath))
}

function deny(path: string, reason: string): ToolPolicyDecision {
  return { allowed: false, resolvedPath: resolve(path), reason }
}

function realBoundaryPath(path: string): string {
  const suffix: string[] = []
  let current = resolve(path)
  while (!existsSync(current)) {
    const parent = dirname(current)
    if (parent === current) break
    suffix.unshift(basename(current))
    current = parent
  }
  const realCurrent = existsSync(current) ? realpathSync(current) : current
  return resolve(realCurrent, ...suffix)
}

function isAgentArtifactPath(workRoot: string, path: string): boolean {
  const relativePath = relative(resolve(workRoot), resolve(path)).replace(/\\/g, '/')
  const parts = relativePath.split('/')
  return parts.length >= 5 && parts[0] === 'reports' && parts[2] === 'agent-artifacts'
}

export function createLearningToolPolicy(
  config: SkillLearningConfig,
  options: LearningToolPolicyOptions = {},
): LearningToolPolicy {
  const readRoots = [config.paths.tasksDir, ...config.paths.runRoots, config.paths.workDir].map(path =>
    realBoundaryPath(path),
  )
  const writeRoot = realBoundaryPath(config.paths.workDir)
  const allowStdCodeReads = config.policy.allowStdCodeForLearning && (options.allowStdCodeReads ?? true)

  return {
    canRead(path: string): ToolPolicyDecision {
      const resolvedPath = resolve(path)
      const realPath = realBoundaryPath(resolvedPath)
      if (!allowStdCodeReads && /(^|[\\/])std_code([\\/]|$)/i.test(resolvedPath)) {
        return deny(resolvedPath, 'std_code reads are disabled for learning')
      }
      if (!readRoots.some(root => isWithinDirectory(root, realPath))) {
        return deny(resolvedPath, 'read outside learning read roots')
      }
      return { allowed: true, resolvedPath }
    },
    canWrite(path: string): ToolPolicyDecision {
      const resolvedPath = resolve(path)
      const realPath = realBoundaryPath(resolvedPath)
      if (!isWithinDirectory(writeRoot, realPath)) {
        return deny(resolvedPath, 'write outside output/skill-learning workDir')
      }
      if (!isAgentArtifactPath(writeRoot, realPath)) {
        return deny(resolvedPath, 'writes are limited to reports/<cycle>/agent-artifacts/<taskId>')
      }
      return { allowed: true, resolvedPath }
    },
  }
}
