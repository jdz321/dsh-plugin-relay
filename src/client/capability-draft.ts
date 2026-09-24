/**
 * Pure draft/entry helpers of the capability editor (no React, no host
 * imports) — unit-tested directly. The context-window field of a draft is the
 * raw text the user typed; `parseContextWindow` (format.ts) turns it into the
 * numeric token count at the draft→entry boundary.
 */

import { groupedNumber, parseContextWindow } from './format.js'
import type { Translator } from './locale.js'

/** One capability dict entry as served/stored (fields optional). */
export interface CapDictEntry {
  input?: string[]
  reasoning?: false | string[]
  contextWindow?: number
}

/** Tri-state reasoning: on with levels, off, or undeclared. */
export type ReasoningState = 'on' | 'off' | null

export interface CapabilityDraft {
  input: string[]
  reasoning: ReasoningState
  levels: string[]
  /** Raw text (may be `1M` / `256k` / `1_048_576`); '' = unconfigured. */
  contextWindow: string
}

export function reasoningOf(entry: CapDictEntry): ReasoningState {
  return entry.reasoning === false ? 'off' : Array.isArray(entry.reasoning) ? 'on' : null
}

export function draftFromEntry(entry: CapDictEntry): CapabilityDraft {
  return {
    input: entry.input ? [...entry.input] : [],
    reasoning: reasoningOf(entry),
    levels: Array.isArray(entry.reasoning) ? [...entry.reasoning] : [],
    contextWindow: entry.contextWindow !== undefined ? String(entry.contextWindow) : '',
  }
}

/** Seed a draft from the nullable derived view the server sends (null → undeclared). */
export function draftFromView(view: { input?: string[] | null, reasoning?: false | string[] | null, contextWindow?: number | null }): CapabilityDraft {
  return draftFromEntry({
    input: view.input ?? undefined,
    reasoning: view.reasoning ?? undefined,
    contextWindow: view.contextWindow ?? undefined,
  })
}

/**
 * Build a dict entry from a draft; undefined = nothing configured. Throws
 * `levels-required` when reasoning is on without levels and `context-invalid`
 * when the context window text does not parse (both localized at the call
 * site). The context value is converted here — the entry always carries the
 * numeric token count.
 */
export function entryFromDraft(draft: CapabilityDraft): CapDictEntry | undefined {
  if (draft.reasoning === 'on' && draft.levels.length === 0) {
    throw new Error('levels-required')
  }
  const entry: CapDictEntry = {}
  if (draft.input.length > 0) entry.input = [...draft.input]
  if (draft.reasoning === 'off') entry.reasoning = false
  else if (draft.reasoning === 'on') entry.reasoning = [...draft.levels]
  const context = draft.contextWindow.trim()
  if (context !== '') {
    const parsed = parseContextWindow(context)
    if (parsed === null) throw new Error('context-invalid')
    entry.contextWindow = parsed
  }
  return Object.keys(entry).length > 0 ? entry : undefined
}

/**
 * Live hint for the context input: the token count the current text resolves
 * to, e.g. `1M = 1,048,576`. Null when the text is blank or invalid (the
 * invalid case renders the error hint instead).
 */
export function contextWindowHint(text: string): string | null {
  const trimmed = text.trim()
  if (trimmed === '') return null
  const parsed = parseContextWindow(trimmed)
  if (parsed === null) return null
  return `${trimmed} = ${groupedNumber(parsed)}`
}

/** `文本 / 图片 · medium · 1M`-style one-line summary of a stored entry. */
export function entrySummary(entry: CapDictEntry | undefined, t: Translator): string {
  const parts: string[] = []
  parts.push(entry?.input?.length ? entry.input.join(' / ') : '—')
  if (entry?.reasoning === false) parts.push(t('capReasoningOff'))
  else if (entry && Array.isArray(entry.reasoning)) parts.push(entry.reasoning.join(' / '))
  else parts.push(t('capReasoningUndeclared'))
  parts.push(entry?.contextWindow !== undefined ? String(entry.contextWindow) : '—')
  return parts.join(' · ')
}
