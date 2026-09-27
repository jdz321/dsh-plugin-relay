/**
 * The 「使用日志」 tab: a statistics header (用量 / RPM / TPM over the current
 * filter window), filter row (time range, model, key, group — applied on
 * 查询, reset by 重置), the log table (time / key / group / model / stream
 * type / usage with cache+reasoning detail / durations / cost), and
 * pagination. Data comes from the host's /api/relay/logs* routes.
 */

import { useCallback, useEffect, useState } from 'react'
import { Button, Tag } from '@deepseek-ai/dsh-client-ui-primitives'

import { apiGet } from './api.js'
import { datetimeLocalSeconds, datetimeLocalValue, endOfMonthSeconds, formatLogTime, secondsLabel, startOfMonthSeconds } from './format.js'
import { tokenCountText, type Translator } from './locale.js'
import { MenuSelect } from './menu-select.js'

/** One shaped log row from GET /api/relay/logs. */
export interface LogRow {
  createdAt: number
  tokenName: string
  group: string
  modelName: string
  quota: number
  promptTokens: number
  completionTokens: number
  cacheCreationTokens: number
  cacheReadTokens: number
  reasoningTokens: number
  reasoningEffort: string
  useTime: number
  isStream: boolean
  frt: number | null
}

interface LogsPayload {
  ok: boolean
  error?: string
  page?: number
  pageSize?: number
  total?: number
  logs?: LogRow[]
}

interface StatPayload {
  ok: boolean
  error?: string
  stat?: { quota: number, quotaCny: string, rpm: number, tpm: number }
}

interface MetaPayload {
  ok: boolean
  models?: string[]
  groups?: Record<string, string>
}

interface Filters {
  start: string
  end: string
  modelName: string
  tokenName: string
  group: string
}

function defaultFilters(): Filters {
  return {
    start: datetimeLocalValue(startOfMonthSeconds()),
    end: datetimeLocalValue(endOfMonthSeconds()),
    modelName: '',
    tokenName: '',
    group: '',
  }
}

const PAGE_SIZE = 10

/** Compact CNY with up to 6 decimals, trailing zeros trimmed (¥0.019328 style). */
function costCny(quota: number): string {
  return String(Number((quota / 500000).toFixed(6)))
}

export interface LogsTabProps {
  t: Translator
  /** Owning panel id — every request addresses this panel. */
  panel: string
  /** Key names for the key filter dropdown (from the API Keys tab data). */
  keyNames: string[]
}

export function LogsTab({ t, panel, keyNames }: LogsTabProps): JSX.Element {
  const [filters, setFilters] = useState<Filters>(defaultFilters)
  const [applied, setApplied] = useState<Filters>(defaultFilters)
  const [page, setPage] = useState(1)
  const [data, setData] = useState<LogsPayload | null>(null)
  const [stat, setStat] = useState<StatPayload['stat'] | null>(null)
  const [meta, setMeta] = useState<MetaPayload | null>(null)
  const [loading, setLoading] = useState(false)

  const fetchPage = useCallback((target: Filters, targetPage: number): void => {
    setLoading(true)
    const params = new URLSearchParams({ p: String(targetPage), pageSize: String(PAGE_SIZE) })
    const start = datetimeLocalSeconds(target.start)
    const end = datetimeLocalSeconds(target.end)
    if (Number.isFinite(start)) params.set('start', String(start))
    if (Number.isFinite(end)) params.set('end', String(end))
    if (target.modelName) params.set('modelName', target.modelName)
    if (target.tokenName) params.set('tokenName', target.tokenName)
    if (target.group) params.set('group', target.group)
    params.set('panel', panel)
    apiGet(`/api/relay/logs?${params.toString()}`)
      .then((body) => setData(body as unknown as LogsPayload))
      .catch((err) => setData({ ok: false, error: err instanceof Error ? err.message : String(err) }))
      .finally(() => setLoading(false))
    const statParams = new URLSearchParams({ panel })
    if (Number.isFinite(start)) statParams.set('start', String(start))
    if (Number.isFinite(end)) statParams.set('end', String(end))
    apiGet(`/api/relay/logs-stat?${statParams.toString()}`)
      .then((body) => {
        const payload = body as unknown as StatPayload
        setStat(payload.ok ? payload.stat ?? null : null)
      })
      .catch(() => setStat(null))
  }, [panel])

  useEffect(() => {
    fetchPage(defaultFilters(), 1)
    apiGet(`/api/relay/logs-meta?panel=${encodeURIComponent(panel)}`)
      .then((body) => setMeta(body as unknown as MetaPayload))
      .catch(() => setMeta({ ok: false }))
  }, [fetchPage])

  const apply = (): void => {
    setPage(1)
    setApplied(filters)
    fetchPage(filters, 1)
  }

  const reset = (): void => {
    const fresh = defaultFilters()
    setFilters(fresh)
    setApplied(fresh)
    setPage(1)
    fetchPage(fresh, 1)
  }

  const gotoPage = (target: number): void => {
    setPage(target)
    fetchPage(applied, target)
  }

  const total = data?.total ?? 0
  const pageSize = data?.pageSize || PAGE_SIZE
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const groupNames = Object.keys(meta?.groups ?? {})
  const modelNames = meta?.models ?? []

  return (
    <div className="relay_tabPane">
      <div className="relay_head">
        <div>
          <div className="relay_cardTitle">{t('logsTitle')}</div>
          <p className="relay_metaLine">{t('logsIntro')}</p>
        </div>
      </div>
      <div className="relay_statBar">
        <span className="relay_statItem">{t('logsStatUsage')} <span className="relay_statValue">{stat ? `¥${stat.quotaCny}` : '—'}</span></span>
        <span className="relay_statItem">RPM <span className="relay_statValue">{stat ? stat.rpm : '—'}</span></span>
        <span className="relay_statItem">TPM <span className="relay_statValue">{stat ? tokenCountText(stat.tpm) : '—'}</span></span>
      </div>
      <div className="relay_card">
        <div className="relay_filters">
          <label className="relay_filterField relay_filterFieldGrow">
            <span className="relay_fieldLabel">{t('logsFilterStart')} ~ {t('logsFilterEnd')}</span>
            <span className="relay_row relay_rowTime">
              <input
                type="datetime-local"
                className="relay_input"
                value={filters.start}
                onChange={(e) => setFilters((f) => ({ ...f, start: e.target.value }))}
              />
              <span className="relay_filterTilde" aria-hidden="true">~</span>
              <input
                type="datetime-local"
                className="relay_input"
                value={filters.end}
                onChange={(e) => setFilters((f) => ({ ...f, end: e.target.value }))}
              />
            </span>
          </label>
          <div className="relay_filterRow">
            <label className="relay_filterField">
              <span className="relay_fieldLabel">{t('logsFilterModel')}</span>
              <MenuSelect
                value={filters.modelName}
                placeholder={t('logsAllModels')}
                items={modelNames.map((name) => ({ id: name, label: name }))}
                onSelect={(id) => setFilters((f) => ({ ...f, modelName: id }))}
              />
            </label>
            <label className="relay_filterField">
              <span className="relay_fieldLabel">{t('logsFilterKey')}</span>
              <MenuSelect
                value={filters.tokenName}
                placeholder={t('logsAllKeys')}
                items={keyNames.map((name) => ({ id: name, label: name }))}
                onSelect={(id) => setFilters((f) => ({ ...f, tokenName: id }))}
              />
            </label>
            <label className="relay_filterField">
              <span className="relay_fieldLabel">{t('logsFilterGroup')}</span>
              <MenuSelect
                value={filters.group}
                placeholder={t('logsAllGroups')}
                items={groupNames.map((name) => ({ id: name, label: meta?.groups?.[name] ? `${name}（${meta.groups[name]}）` : name }))}
                onSelect={(id) => setFilters((f) => ({ ...f, group: id }))}
              />
            </label>
            <div className="relay_formActions">
              <Button variant="primary" size="sm" disabled={loading} onClick={apply}>
                {t('logsQuery')}
              </Button>
              <Button variant="outline" size="sm" disabled={loading} onClick={reset}>
                {t('logsReset')}
              </Button>
            </div>
          </div>
        </div>
      </div>
      {data === null ? <div className="relay_empty">{t('loading')}</div>
        : !data.ok ? <div className="relay_msg relay_msgErr">{`${t('logsLoadFail')}: ${String(data.error ?? '?')}`}</div>
        : (data.logs ?? []).length === 0 ? <div className="relay_empty">{t('logsEmpty')}</div>
        : (
          <div className="relay_logTable">
            <table>
              <LogTableHeader t={t} />
              <tbody>
                {(data.logs ?? []).map((log, index) => (
                  <LogRowView key={`${log.createdAt}-${index}`} log={log} t={t} />
                ))}
              </tbody>
            </table>
          </div>
          )}
      <div className="relay_pagination">
        <span className="relay_pageInfo">{t('logsTotal')(total)}</span>
        <Button variant="outline" size="sm" disabled={loading || page <= 1} onClick={() => gotoPage(page - 1)}>
          {t('logsPrev')}
        </Button>
        <span className="relay_pageInfo">{t('logsPageInfo')(page, pages)}</span>
        <Button variant="outline" size="sm" disabled={loading || page >= pages} onClick={() => gotoPage(page + 1)}>
          {t('logsNext')}
        </Button>
      </div>
    </div>
  )
}

/** Header row of the log table, rendered once above the rows. */
export function LogTableHeader({ t }: { t: Translator }): JSX.Element {
  const columns: Array<[string, string]> = [
    ['24%', t('colTime')],
    ['12%', t('colKey')],
    ['8%', t('colGroup')],
    ['17%', t('colLogModel')],
    ['8%', t('colType')],
    ['14%', t('colUsage')],
    ['8%', t('colDuration')],
    ['9%', t('colCost')],
  ]
  return (
    <thead>
      <tr>
        {columns.map(([width, label]) => <th key={label} style={{ width }}>{label}</th>)}
      </tr>
    </thead>
  )
}

function LogRowView({ log, t }: { log: LogRow, t: Translator }): JSX.Element {
  const usageDetail: string[] = []
  if (log.cacheCreationTokens > 0) usageDetail.push(`📋${tokenCountText(log.cacheCreationTokens)}`)
  if (log.cacheReadTokens > 0) usageDetail.push(`⚡${tokenCountText(log.cacheReadTokens)}`)
  if (log.reasoningTokens > 0) usageDetail.push(`✦${tokenCountText(log.reasoningTokens)}`)
  return (
    <tr>
      <td className="relay_logMono">{formatLogTime(log.createdAt)}</td>
      <td>{log.tokenName || '—'}</td>
      <td>{log.group || '—'}</td>
      <td className="relay_logMono">{log.modelName || '—'}</td>
      <td>
        <Tag tone={log.isStream ? 'success' : 'outline'}>{log.isStream ? t('typeStream') : t('typeNonStream')}</Tag>
      </td>
      <td>
        <div>↑{tokenCountText(log.promptTokens)} ↓{tokenCountText(log.completionTokens)}</div>
        {usageDetail.length > 0 && <div className="relay_logSub">{usageDetail.join(' ')}</div>}
      </td>
      <td>
        <div>{t('durationFirst')} {secondsLabel(log.frt)}</div>
        <div className="relay_logSub">{t('durationTotal')} {secondsLabel(log.useTime)}</div>
      </td>
      <td className="relay_logCost">¥{costCny(log.quota)}</td>
    </tr>
  )
}
