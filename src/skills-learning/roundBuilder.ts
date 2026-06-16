import type { RoundAttempt, ToolInvocation, TrajectoryRecord } from './types.js'

function ensureRound(rounds: Map<number, RoundAttempt>, round: number): RoundAttempt {
  const existing = rounds.get(round)
  if (existing) return existing
  const created: RoundAttempt = {
    round,
    assistantText: [],
    toolInvocations: [],
    finalizes: [],
    submissionValidations: [],
    judgeResults: [],
    unknownRecords: [],
  }
  rounds.set(round, created)
  return created
}

export function buildRounds(records: TrajectoryRecord[]): RoundAttempt[] {
  const rounds = new Map<number, RoundAttempt>()
  const toolsByRoundAndId = new Map<number, Map<string, ToolInvocation>>()

  function toolsForRound(round: number): Map<string, ToolInvocation> {
    const existing = toolsByRoundAndId.get(round)
    if (existing) return existing
    const created = new Map<string, ToolInvocation>()
    toolsByRoundAndId.set(round, created)
    return created
  }

  for (const record of records) {
    if (typeof record.round !== 'number') continue
    const round = ensureRound(rounds, record.round)
    const roundToolsById = toolsForRound(record.round)

    if (record.kind === 'assistant_text') {
      if (typeof record.text === 'string') round.assistantText.push(record.text)
      continue
    }

    if (record.kind === 'tool_call') {
      const invocation: ToolInvocation = {
        tool: typeof record.tool === 'string' ? record.tool : 'unknown',
        toolUseId: typeof record.tool_use_id === 'string' ? record.tool_use_id : undefined,
        input: record.input,
      }
      round.toolInvocations.push(invocation)
      if (invocation.toolUseId) roundToolsById.set(invocation.toolUseId, invocation)
      continue
    }

    if (record.kind === 'tool_result') {
      const toolUseId = typeof record.tool_use_id === 'string' ? record.tool_use_id : undefined
      const invocation = toolUseId ? roundToolsById.get(toolUseId) : undefined
      const result = {
        ok: typeof record.ok === 'boolean' ? record.ok : undefined,
        text: typeof record.text === 'string' ? record.text : undefined,
      }
      if (invocation) {
        invocation.result = result
      } else {
        round.toolInvocations.push({ tool: 'unknown', toolUseId, result })
      }
      continue
    }

    if (record.kind === 'finalize') {
      round.finalizes.push(record)
      continue
    }

    if (
      record.kind === 'submission_validation_failed' ||
      record.kind === 'submission_validation_passed'
    ) {
      round.submissionValidations.push(record)
      continue
    }

    if (record.kind === 'judge_result') {
      round.judgeResults.push(record)
      continue
    }

    round.unknownRecords.push(record)
  }

  return [...rounds.values()].sort((a, b) => a.round - b.round)
}
