export type TrajectoryRecord = {
  kind: string
  round?: number
  [key: string]: unknown
}

export type RunIndexEntry = {
  runId: string
  taskId: string
  status: string
  rounds: number
  reward: number
  runDir: string
  logsDir: string
  trajectoryPath: string
  summaryPath: string
}

export type ToolInvocation = {
  tool: string
  toolUseId?: string
  input?: unknown
  result?: {
    ok?: boolean
    text?: string
  }
}

export type RoundAttempt = {
  round: number
  assistantText: string[]
  toolInvocations: ToolInvocation[]
  finalizes: TrajectoryRecord[]
  submissionValidations: TrajectoryRecord[]
  judgeResults: TrajectoryRecord[]
  unknownRecords: TrajectoryRecord[]
}

export type ArtifactIndex = {
  runDir: string
  taskDir: string
  paths: {
    public: string[]
    workspace: string[]
    outputs: string[]
    logs: string[]
    stdCode: string[]
    evaluation: string[]
    metrics: string[]
    readmes: string[]
  }
}

export type EvidenceRunInput = {
  run: RunIndexEntry
  records: TrajectoryRecord[]
  artifacts: ArtifactIndex
}

export type EvidenceKind =
  | 'success'
  | 'success-vs-failure'
  | 'failure-vs-std-code'

export type EvidencePackage = {
  kind: EvidenceKind
  taskId: string
  runIds: string[]
  roundSummaries: Array<{
    runId: string
    round: number
    assistantText: string
    toolInvocations: ToolInvocation[]
  }>
  toolUsage: Array<{
    tool: string
    count: number
  }>
  judgeOutcomes: Array<{
    runId: string
    round: number
    status?: unknown
    reward?: unknown
    feedback?: unknown
  }>
  artifactPaths: string[]
}
