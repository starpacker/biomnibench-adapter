import { buildRounds } from './roundBuilder.js'
import type {
  ArtifactIndex,
  EvidencePackage,
  EvidenceRunInput,
} from './types.js'

type BuildEvidenceInput = {
  taskId: string
  successes: EvidenceRunInput[]
  failures: EvidenceRunInput[]
}

function artifactPaths(artifacts: ArtifactIndex[]): string[] {
  return [
    ...new Set(
      artifacts.flatMap(artifact => [
        ...artifact.paths.public,
        ...artifact.paths.workspace,
        ...artifact.paths.outputs,
        ...artifact.paths.logs,
        ...artifact.paths.stdCode,
        ...artifact.paths.evaluation,
        ...artifact.paths.metrics,
        ...artifact.paths.readmes,
      ].map(path => path.replace(/\\/g, '/'))),
    ),
  ].sort()
}

function collectRoundSummaries(runs: EvidenceRunInput[]): EvidencePackage['roundSummaries'] {
  return runs.flatMap(input =>
    buildRounds(input.records).map(round => ({
      runId: input.run.runId,
      round: round.round,
      assistantText: round.assistantText.join('\n\n'),
      toolInvocations: round.toolInvocations,
    })),
  )
}

function collectToolUsage(roundSummaries: EvidencePackage['roundSummaries']): EvidencePackage['toolUsage'] {
  const counts = new Map<string, number>()
  for (const round of roundSummaries) {
    for (const invocation of round.toolInvocations) {
      counts.set(invocation.tool, (counts.get(invocation.tool) ?? 0) + 1)
    }
  }
  return [...counts.entries()]
    .map(([tool, count]) => ({ tool, count }))
    .sort((a, b) => a.tool.localeCompare(b.tool))
}

function collectJudgeOutcomes(runs: EvidenceRunInput[]): EvidencePackage['judgeOutcomes'] {
  return runs.flatMap(input =>
    buildRounds(input.records).flatMap(round =>
      round.judgeResults.map(judge => ({
        runId: input.run.runId,
        round: round.round,
        status: judge.status,
        reward: judge.reward,
        feedback: judge.feedback,
      })),
    ),
  )
}

function makePackage(kind: EvidencePackage['kind'], taskId: string, runs: EvidenceRunInput[]): EvidencePackage {
  const roundSummaries = collectRoundSummaries(runs)
  return {
    kind,
    taskId,
    runIds: runs.map(input => input.run.runId),
    roundSummaries,
    toolUsage: collectToolUsage(roundSummaries),
    judgeOutcomes: collectJudgeOutcomes(runs),
    artifactPaths: artifactPaths(runs.map(input => input.artifacts)),
  }
}

export function buildEvidencePackages(input: BuildEvidenceInput): EvidencePackage[] {
  const packages: EvidencePackage[] = []
  const successes = input.successes
  const failures = input.failures
  const failuresWithStdCode = failures.filter(failure => failure.artifacts.paths.stdCode.length > 0)

  if (successes.length > 0) packages.push(makePackage('success', input.taskId, successes))
  if (successes.length > 0 && failures.length > 0) {
    packages.push(makePackage('success-vs-failure', input.taskId, [...successes, ...failures]))
  }
  if (failuresWithStdCode.length > 0) {
    packages.push(makePackage('failure-vs-std-code', input.taskId, failuresWithStdCode))
  }

  return packages
}
