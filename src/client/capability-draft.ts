/**
 * Pure draft/entry helpers of the capability editor (no React, no host
 * imports) — unit-tested directly. The context-window and output-limit
 * fields of a draft are the raw text the user typed; `parseContextWindow`
 * (format.ts) turns them into numeric token counts at the draft→entry
 * boundary (context caps at 10M, output at 1,048,576 — the host enforces the
 * same bounds).
 */

import { MAX_TOKENS_MAX } from '../constants.js'
import { CONTEXT_WINDOW_MAX, groupedNumber, parseContextWindow } from './format.js'
import { tokenCountText, type Translator } from './locale.js'

/** One capability dict entry as served/stored (fields optional). */
export interface CapDictEntry {
  input?: string[]
  reasoning?: false | string[]
  contextWindow?: number
  maxTokens?: number
}

/** Tri-state reasoning: on with levels, off, or undeclared. */
export type ReasoningState = 'on' | 'off' | null

export interface CapabilityDraft {
  input: string[]
  reasoning: ReasoningState
  levels: string[]
  /** Raw text (may be `1M` / `256k` / `1_048_576`); '' = unconfigured. */
  contextWindow: string
  /** Raw output-limit text, same shorthand rules; '' = unconfigured. */
  maxTokens: string
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
    maxTokens: entry.maxTokens !== undefined ? String(entry.maxTokens) : '',
  }
}

/** Seed a draft from the nullable derived view the server sends (null → undeclared). */
export function draftFromView(view: { input?: string[] | null, reasoning?: false | string[] | null, contextWindow?: number | null, maxTokens?: number | null }): CapabilityDraft {
  return draftFromEntry({
    input: view.input ?? undefined,
    reasoning: view.reasoning ?? undefined,
    contextWindow: view.contextWindow ?? undefined,
    maxTokens: view.maxTokens ?? undefined,
  })
}

/**
 * Build a dict entry from a draft; undefined = nothing configured. Throws
 * `levels-required` when reasoning is on without levels, `context-invalid`
 * when the context text does not parse, and `max-tokens-invalid` when the
 * output-limit text does not parse (all localized at the call site). The
 * text values are converted here — the entry always carries token counts.
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
  const maxTokens = draft.maxTokens.trim()
  if (maxTokens !== '') {
    const parsed = parseContextWindow(maxTokens, MAX_TOKENS_MAX)
    if (parsed === null) throw new Error('max-tokens-invalid')
    entry.maxTokens = parsed
  }
  return Object.keys(entry).length > 0 ? entry : undefined
}

/**
 * Live hint for a token-count input: the count the current text resolves to,
 * e.g. `1M = 1,048,576`. Null when the text is blank or invalid (the invalid
 * case renders the error hint instead).
 */
export function tokenCountHint(text: string, max: number = CONTEXT_WINDOW_MAX): string | null {
  const trimmed = text.trim()
  if (trimmed === '') return null
  const parsed = parseContextWindow(trimmed, max)
  if (parsed === null) return null
  return `${trimmed} = ${groupedNumber(parsed)}`
}

/** Live hint for the context-window input (10M cap). */
export function contextWindowHint(text: string): string | null {
  return tokenCountHint(text)
}

/** Live hint for the output-limit input (1,048,576 cap). */
export function maxTokensHint(text: string): string | null {
  return tokenCountHint(text, MAX_TOKENS_MAX)
}

/** `文本 / 图片 · medium · 1M · 出 64k`-style one-line summary of a stored entry. */
export function entrySummary(entry: CapDictEntry | undefined, t: Translator): string {
  const parts: string[] = []
  parts.push(entry?.input?.length ? entry.input.join(' / ') : '—')
  if (entry?.reasoning === false) parts.push(t('capReasoningOff'))
  else if (entry && Array.isArray(entry.reasoning)) parts.push(entry.reasoning.join(' / '))
  else parts.push(t('capReasoningUndeclared'))
  parts.push(entry?.contextWindow !== undefined ? tokenCountText(entry.contextWindow) : '—')
  if (entry?.maxTokens !== undefined) parts.push(t('capMaxShort')(tokenCountText(entry.maxTokens)))
  return parts.join(' · ')
}
