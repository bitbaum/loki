/**
 * Typed IPC boundary for cloud-dispatched pending_commands rows.
 *
 * Pre-v0.7 the poller did `command.payload as { tab?: string; prompt?: string }`
 * — an unchecked cast. That worked while the cloud was the only source of
 * commands and we trusted its serialization. Once the autonomous scheduler
 * (Change 5) starts INSERT'ing pending_commands unattended via cron, the
 * boundary needs to refuse:
 *   - unknown command.type values (a misconfigured cron typo)
 *   - missing required payload fields (the cron forgot to attach a tab)
 *   - non-string fields where strings are expected (DB corruption, manual
 *     INSERT with wrong types)
 *
 * Hand-rolled guards rather than zod because the desktop main-process
 * bundle stays lean — adding a runtime validation dep for one function
 * is overkill. If we add more command types in the desktop's pipeline,
 * revisit the dep tradeoff.
 *
 * Mirrors the per-type payload contracts defined in
 * src/db/schema/pending-commands.ts on the cloud side. The executable type
 * list is shared through src/lib/pending-command-contract.ts.
 */

import { isFleetRunnerCommandType } from '@/lib/pending-command-contract'
import { parseAgentImages, type AgentImage } from '@/lib/agent-attachments'

export interface InjectCommand {
  type: 'inject'
  payload: {
    tab: string
    prompt: string
    /** Screenshots the runner writes to files (lib/agent-attachments). */
    attachments?: AgentImage[]
    /** Optional model + adapter hints — daemon-bash respects these but the
     *  desktop's inject path just types into the existing zellij tab, so
     *  we accept-but-don't-act on them rather than rejecting. */
    promptKey?: string
    promptLabel?: string
    adapter?: string
    model?: string
    projectId?: string | null
    projectKey?: string
    runId?: string
    sessionId?: string
  }
}

export interface TabCommand {
  type: 'close_tab'
  payload: {
    tab: string
  }
}

export interface LaunchAgentCommand {
  type: 'launch_agent'
  payload: {
    tab: string
    dir: string
    agent: string
    model?: string
    initialPrompt?: string
  }
}

export interface DispatchCommand {
  type: 'dispatch'
  payload: {
    tab: string
    dir: string
    agent: string
    prompt: string
    /** Screenshots the runner writes to files (lib/agent-attachments). */
    attachments?: AgentImage[]
    model?: string
    promptKey?: string
    promptLabel?: string
    projectKey?: string
    runId?: string
    sessionId?: string
  }
}

export interface SwitchAgentCommand {
  type: 'switch_agent'
  payload: {
    tab: string
    dir: string
    toAgent: string
    fromAgent?: string
    model?: string
  }
}

export interface AutoContinueCommand {
  type: 'auto_continue'
  payload: {
    tab: string
    enabled: boolean
  }
}

export interface InstallCliCommand {
  type: 'install_cli'
  payload: {
    agent: string
  }
}

export interface PeekTabCommand {
  type: 'peek_tab'
  payload: {
    tab: string
  }
}

export interface PeekStreamCommand {
  type: 'peek_start' | 'peek_stop'
  payload: {
    tab: string
  }
}

/** Every command type the desktop is allowed to execute today. Adding a
 *  new type means: extend this union + write a guard + handle it in poller. */
export type ValidatedCommand =
  | InjectCommand
  | DispatchCommand
  | TabCommand
  | LaunchAgentCommand
  | SwitchAgentCommand
  | AutoContinueCommand
  | InstallCliCommand
  | PeekTabCommand
  | PeekStreamCommand

export type ValidationResult =
  | { ok: true; command: ValidatedCommand }
  | { ok: false; error: string }

/**
 * Validate a raw command row pulled from /api/control/commands or the
 * bridge SSE payload. Returns either a tagged-union narrowed command or
 * a structured error explaining the rejection.
 */
export function validateCommand(raw: unknown): ValidationResult {
  if (!isObject(raw)) {
    return { ok: false, error: 'Command must be an object' }
  }
  const type = (raw as { type?: unknown }).type
  if (typeof type !== 'string') {
    return { ok: false, error: 'Command.type must be a string' }
  }
  const payload = (raw as { payload?: unknown }).payload
  if (!isObject(payload)) {
    return { ok: false, error: 'Command.payload must be an object' }
  }

  if (!isFleetRunnerCommandType(type)) {
    return {
      ok: false,
      error: `Fleet Runner does not handle command type '${type}'. Add it to command-validator.ts when you wire a new executor.`,
    }
  }

  switch (type) {
    case 'inject':
      return validateInject(payload)
    case 'dispatch':
      return validateDispatch(payload)
    case 'close_tab':
      return validateTab(type, payload)
    case 'launch_agent':
      return validateLaunchAgent(payload)
    case 'switch_agent':
      return validateSwitchAgent(payload)
    case 'auto_continue':
      return validateAutoContinue(payload)
    case 'install_cli':
      return validateInstallCli(payload)
    case 'peek_tab':
      return validatePeekTab(payload)
    case 'peek_start':
    case 'peek_stop':
      return validatePeekStream(type, payload)
  }
}

function validatePeekTab(payload: Record<string, unknown>): ValidationResult {
  const tab = payload.tab
  if (typeof tab !== 'string' || tab.trim().length === 0) {
    return { ok: false, error: "peek_tab payload missing required string 'tab'" }
  }
  return { ok: true, command: { type: 'peek_tab', payload: { tab } } }
}

function validatePeekStream(type: 'peek_start' | 'peek_stop', payload: Record<string, unknown>): ValidationResult {
  const tab = payload.tab
  if (typeof tab !== 'string' || tab.trim().length === 0) {
    return { ok: false, error: `${type} payload missing required string 'tab'` }
  }
  return { ok: true, command: { type, payload: { tab } } }
}

function validateInject(payload: Record<string, unknown>): ValidationResult {
  const tab = payload.tab
  const prompt = payload.prompt
  if (typeof tab !== 'string' || tab.trim().length === 0) {
    return { ok: false, error: "Inject payload missing required string 'tab'" }
  }
  if (typeof prompt !== 'string' || prompt.length === 0) {
    return { ok: false, error: "Inject payload missing required string 'prompt'" }
  }
  // Optional fields — accept if absent or if the right primitive type;
  // refuse if present-but-wrong-type so the boundary catches drift early.
  for (const field of ['promptKey', 'promptLabel', 'adapter', 'model', 'projectKey', 'runId', 'sessionId'] as const) {
    const v = payload[field]
    if (v !== undefined && typeof v !== 'string') {
      return { ok: false, error: `Inject payload field '${field}' must be a string if present` }
    }
  }
  if (payload.projectId !== undefined && payload.projectId !== null && typeof payload.projectId !== 'string') {
    return { ok: false, error: "Inject payload field 'projectId' must be a string or null if present" }
  }
  const injectImages = parseAgentImages(payload.attachments)
  if (!injectImages.ok) return { ok: false, error: `Inject payload: ${injectImages.error}` }

  return {
    ok: true,
    command: {
      type: 'inject',
      payload: {
        tab,
        prompt,
        promptKey: payload.promptKey as string | undefined,
        promptLabel: payload.promptLabel as string | undefined,
        adapter: payload.adapter as string | undefined,
        model: payload.model as string | undefined,
        projectId: (payload.projectId ?? null) as string | null,
        projectKey: payload.projectKey as string | undefined,
        runId: payload.runId as string | undefined,
        sessionId: payload.sessionId as string | undefined,
        ...(injectImages.images.length > 0 ? { attachments: injectImages.images } : {}),
      },
    },
  }
}

function validateDispatch(payload: Record<string, unknown>): ValidationResult {
  const tab = payload.tab
  const dir = payload.dir
  const agent = payload.agent
  const prompt = payload.prompt
  if (typeof tab !== 'string' || tab.trim().length === 0) {
    return { ok: false, error: "dispatch payload missing required string 'tab'" }
  }
  if (typeof dir !== 'string' || dir.trim().length === 0) {
    return { ok: false, error: "dispatch payload missing required string 'dir'" }
  }
  if (typeof agent !== 'string' || agent.trim().length === 0) {
    return { ok: false, error: "dispatch payload missing required string 'agent'" }
  }
  if (typeof prompt !== 'string' || prompt.length === 0) {
    return { ok: false, error: "dispatch payload missing required string 'prompt'" }
  }
  for (const field of ['model', 'promptKey', 'promptLabel', 'projectKey', 'runId', 'sessionId'] as const) {
    const v = payload[field]
    if (v !== undefined && typeof v !== 'string') {
      return { ok: false, error: `dispatch payload field '${field}' must be a string if present` }
    }
  }
  const dispatchImages = parseAgentImages(payload.attachments)
  if (!dispatchImages.ok) return { ok: false, error: `dispatch payload: ${dispatchImages.error}` }
  return {
    ok: true,
    command: {
      type: 'dispatch',
      payload: {
        tab,
        dir,
        agent,
        prompt,
        model: payload.model as string | undefined,
        promptKey: payload.promptKey as string | undefined,
        promptLabel: payload.promptLabel as string | undefined,
        projectKey: payload.projectKey as string | undefined,
        runId: payload.runId as string | undefined,
        sessionId: payload.sessionId as string | undefined,
        ...(dispatchImages.images.length > 0 ? { attachments: dispatchImages.images } : {}),
      },
    },
  }
}

function validateTab(type: 'close_tab', payload: Record<string, unknown>): ValidationResult {
  const tab = payload.tab
  if (typeof tab !== 'string' || tab.trim().length === 0) {
    return { ok: false, error: `${type} payload missing required string 'tab'` }
  }
  return { ok: true, command: { type, payload: { tab } } }
}

function validateLaunchAgent(payload: Record<string, unknown>): ValidationResult {
  const tab = payload.tab
  const dir = payload.dir
  const agent = payload.agent
  if (typeof tab !== 'string' || tab.trim().length === 0) {
    return { ok: false, error: "launch_agent payload missing required string 'tab'" }
  }
  if (typeof dir !== 'string' || dir.trim().length === 0) {
    return { ok: false, error: "launch_agent payload missing required string 'dir'" }
  }
  if (typeof agent !== 'string' || agent.trim().length === 0) {
    return { ok: false, error: "launch_agent payload missing required string 'agent'" }
  }
  for (const field of ['model', 'initialPrompt'] as const) {
    const v = payload[field]
    if (v !== undefined && typeof v !== 'string') {
      return { ok: false, error: `launch_agent payload field '${field}' must be a string if present` }
    }
  }
  return {
    ok: true,
    command: {
      type: 'launch_agent',
      payload: {
        tab,
        dir,
        agent,
        model: payload.model as string | undefined,
        initialPrompt: payload.initialPrompt as string | undefined,
      },
    },
  }
}

function validateSwitchAgent(payload: Record<string, unknown>): ValidationResult {
  const tab = payload.tab
  const dir = payload.dir
  const toAgent = payload.toAgent
  if (typeof tab !== 'string' || tab.trim().length === 0) {
    return { ok: false, error: "switch_agent payload missing required string 'tab'" }
  }
  if (typeof dir !== 'string' || dir.trim().length === 0) {
    return { ok: false, error: "switch_agent payload missing required string 'dir'" }
  }
  if (typeof toAgent !== 'string' || toAgent.trim().length === 0) {
    return { ok: false, error: "switch_agent payload missing required string 'toAgent'" }
  }
  for (const field of ['fromAgent', 'model'] as const) {
    const v = payload[field]
    if (v !== undefined && typeof v !== 'string') {
      return { ok: false, error: `switch_agent payload field '${field}' must be a string if present` }
    }
  }
  return {
    ok: true,
    command: {
      type: 'switch_agent',
      payload: {
        tab,
        dir,
        toAgent,
        fromAgent: payload.fromAgent as string | undefined,
        model: payload.model as string | undefined,
      },
    },
  }
}

function validateAutoContinue(payload: Record<string, unknown>): ValidationResult {
  const tab = payload.tab
  const enabled = payload.enabled
  if (typeof tab !== 'string' || tab.trim().length === 0) {
    return { ok: false, error: "auto_continue payload missing required string 'tab'" }
  }
  if (typeof enabled !== 'boolean') {
    return { ok: false, error: "auto_continue payload missing required boolean 'enabled'" }
  }
  return { ok: true, command: { type: 'auto_continue', payload: { tab, enabled } } }
}

function validateInstallCli(payload: Record<string, unknown>): ValidationResult {
  const agent = payload.agent
  if (typeof agent !== 'string' || agent.trim().length === 0) {
    return { ok: false, error: "install_cli payload missing required string 'agent'" }
  }
  return { ok: true, command: { type: 'install_cli', payload: { agent } } }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}
