/**
 * The 「数据看板」 tab: balance / today / totals cards plus a stacked
 * per-model bar chart of the last N days (7 / 14 / 30), with a 消耗金额 /
 * Token 量 metric toggle and click-to-hide chart legend. The chart is the
 * hand-written SVG stacked bar (dashboard-chart.tsx) — recharts is gone. The
 * chart palette is read from the shell's design tokens at render time with
 * fixed fallbacks.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Pill } from '@deepseek-ai/dsh-client-ui-primitives'

import { apiGet } from './api.js'
import { StackedBarChart } from './dashboard-chart.js'
import type { Translator } from './locale.js'

/** One aggregated cell from GET /api/relay/dashboard. */
export interface UsageBucket {
  date: string
  model: string
  quota: number
  tokens: number
}

export interface DashboardData {
  balanceCny: string | null
  todayUsedCny: string
  todayTokens: number
  totalUsedCny: string | null
  totalRequests: number | null
  days: number
  buckets: UsageBucket[]
}

interface DashboardPayload {
  ok: boolean
  error?: string
  dashboard?: DashboardData
  warning?: string
}

type Metric = 'cny' | 'tokens'

const DAY_CHOICES = [7, 14, 30] as const

export interface DashboardTabProps {
  t: Translator
  /** Owning panel id. */
  panel: string
}

/** Design-token chart palette, resolved from the shell's computed styles. */
function useChartPalette(seriesCount: number): string[] {
  return useMemo(() => {
    const fallback = ['#5b8fd9', '#57bd8f', '#e0a54f', '#c96f8f', '#8f7bd9', '#5fbcc9', '#d97f5b', '#93a8b8']
    let vars: string[] | null = null
    try {
      const styles = getComputedStyle(document.documentElement)
      const read = (name: string): string => styles.getPropertyValue(name).trim()
      vars = ['--dsw-alias-brand-primary', '--dsw-alias-state-success-primary', '--dsw-alias-state-warning-primary', '--dsw-alias-state-error-primary']
        .map(read)
        .filter((value) => value.length > 0)
    } catch {
      vars = null
    }
    const palette = vars && vars.length >= 2 ? vars : fallback
    if (seriesCount <= palette.length) return palette.slice(0, Math.max(1, seriesCount))
    return Array.from({ length: seriesCount }, (_, i) => palette[i % palette.length]!)
  }, [seriesCount])
}

/** Pivot buckets into one row per date with a column per model. */
export function pivotBuckets(buckets: readonly UsageBucket[], metric: Metric): { rows: Array<Record<string, string | number>>, models: string[] } {
  const models = [...new Set(buckets.map((cell) => cell.model))].sort((a, b) => a.localeCompare(b))
  const byDate = new Map<string, Record<string, string | number>>()
  for (const cell of buckets) {
    const row = byDate.get(cell.date) ?? { date: cell.date }
    row[cell.model] = metric === 'cny' ? Number(cell.quota.toFixed(4)) : cell.tokens
    byDate.set(cell.date, row)
  }
  const rows = [...byDate.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)))
  return { rows, models }
}

export function DashboardTab({ t, panel }: DashboardTabProps): JSX.Element {
  const [data, setData] = useState<DashboardData | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [metric, setMetric] = useState<Metric>('cny')
  const [days, setDays] = useState<number>(7)
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set())

  const refresh = useCallback((targetDays: number): void => {
    setLoading(true)
    apiGet(`/api/relay/dashboard?panel=${encodeURIComponent(panel)}&days=${targetDays}`)
      .then((body) => {
        const payload = body as unknown as DashboardPayload
        if (payload.ok) {
          setData(payload.dashboard ?? null)
          setWarning(payload.warning ?? null)
          setError(null)
        } else {
          setError(String(payload.error ?? '?'))
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false))
  }, [panel])
  useEffect(() => {
    refresh(days)
  }, [refresh, days])

  const { rows, models } = useMemo(() => pivotBuckets(data?.buckets ?? [], metric), [data, metric])
  const palette = useChartPalette(models.length)
  const visible = useMemo(() => models.filter((model) => !hidden.has(model)), [models, hidden])
  const lookup = useCallback((date: string, model: string): { quota: number, tokens: number } | null => {
    const cell = (data?.buckets ?? []).find((bucket) => bucket.date === date && bucket.model === model)
    return cell ?? null
  }, [data])
  // Rescale when visibility changes: only visible series count toward the max.
  const yMax = useMemo(() => {
    let max = 0
    for (const row of rows) {
      let total = 0
      for (const model of visible) total += Number(row[model] ?? 0)
      max = Math.max(max, total)
    }
    return max
  }, [rows, visible])
  const toggle = (model: string): void => {
    setHidden((current) => {
      const next = new Set(current)
      if (next.has(model)) next.delete(model)
      else next.add(model)
      return next
    })
  }

  if (error !== null) {
    return (
      <div className="relay_tabPane">
        <div className="relay_msg relay_msgErr">{`${t('dashLoadFail')}: ${error}`}</div>
      </div>
    )
  }

  return (
    <div className="relay_tabPane">
      <div className="relay_head">
        <div>
          <div className="relay_cardTitle">{t('dashTitle')}</div>
          <p className="relay_metaLine">{t('dashIntro')}</p>
        </div>
        <Button variant="ghost" size="sm" disabled={loading} onClick={() => refresh(days)}>
          {loading ? t('refreshing') : t('dashRefresh')}
        </Button>
      </div>
      {data === null ? <div className="relay_empty">{t('loading')}</div> : (
        <>
          <div className="relay_dashCards">
            <div className="relay_dashCard">
              <span className="relay_dashLabel">{t('dashCardBalance')}</span>
              <span className="relay_dashValue">{data.balanceCny === null ? '—' : `¥${data.balanceCny}`}</span>
            </div>
            <div className="relay_dashCard">
              <span className="relay_dashLabel">{t('dashCardToday')}</span>
              <span className="relay_dashValue">¥{data.todayUsedCny}</span>
              <span className="relay_dashSub">{t('dashTokensUnit')(data.todayTokens)}</span>
            </div>
            <div className="relay_dashCard">
              <span className="relay_dashLabel">{t('dashCardTotalUsed')}</span>
              <span className="relay_dashValue">{data.totalUsedCny === null ? '—' : `¥${data.totalUsedCny}`}</span>
            </div>
            <div className="relay_dashCard">
              <span className="relay_dashLabel">{t('dashCardRequests')}</span>
              <span className="relay_dashValue">{data.totalRequests === null ? '—' : data.totalRequests}</span>
            </div>
          </div>
          {warning !== null && <div className="relay_msg relay_msgErr">{warning}</div>}
          <div className="relay_dashChart">
            <div className="relay_dashChartHead">
              <span className="relay_cardTitle">{t('dashChartTitle')(data.days)}</span>
              <div className="relay_row">
                {DAY_CHOICES.map((choice) => (
                  <Pill key={choice} active={days === choice} onClick={() => setDays(choice)}>
                    {t('dashDays')(choice)}
                  </Pill>
                ))}
                {(['cny', 'tokens'] as const).map((candidate) => (
                  <Pill
                    key={candidate}
                    active={metric === candidate}
                    onClick={() => setMetric(candidate)}
                  >
                    {candidate === 'cny' ? t('dashMetricCny') : t('dashMetricTokens')}
                  </Pill>
                ))}
              </div>
            </div>
            {rows.length === 0 || visible.length === 0 ? <div className="relay_empty">{t('dashEmpty')}</div> : (
              <>
                <StackedBarChart
                  rows={rows}
                  models={models}
                  visible={visible}
                  colors={palette}
                  metric={metric}
                  yMax={yMax}
                  lookup={lookup}
                />
                <div className="relay_chartLegend">
                  {models.map((model, index) => (
                    <button
                      key={model}
                      type="button"
                      className={hidden.has(model) ? 'relay_chartLegendItem relay_chartLegendOff' : 'relay_chartLegendItem'}
                      title={model}
                      onClick={() => toggle(model)}
                    >
                      <span className="relay_chartSwatch" style={{ background: palette[index % palette.length] }} />
                      {model}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}
