/**
 * The 「数据看板」 tab: balance / today / totals cards plus a stacked
 * per-model bar chart of the last N days (7 / 14 / 30), a 消耗金额 / Token 量
 * / 双轴 metric toggle, Top-N series folding (v0.6.1: past the 7th model by
 * window total, everything merges into one grey「其他」series), and a
 * click-to-hide chart legend (the「其他」series is not hideable — hiding it
 * would empty the chart). The chart is the hand-written SVG stacked bar
 * (dashboard-chart.tsx) — recharts is gone. The chart palette is read from
 * the shell's design tokens at render time with fixed fallbacks.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Pill } from '@deepseek-ai/dsh-client-ui-primitives'

import { apiGet } from './api.js'
import { OTHERS_KEY, pivotBuckets, StackedBarChart, TOP_N, topSeries, type ChartMetric, type UsageBucket } from './dashboard-chart.js'
import type { Translator } from './locale.js'

export type { UsageBucket }

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

type Metric = ChartMetric

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

  // Ranking metric: the bars' axis (dual mode stacks spend).
  const rankMetric: 'cny' | 'tokens' = metric === 'tokens' ? 'tokens' : 'cny'
  const { rows: rankRows, models: allModels } = useMemo(() => pivotBuckets(data?.buckets ?? [], rankMetric), [data, rankMetric])
  const { kept, others } = useMemo(() => topSeries(allModels, rankRows), [allModels, rankRows])
  // Stack rows in the kept order + the merged 「其他」 column.
  const series = useMemo(() => [...kept, ...(others.length ? [OTHERS_KEY] : [])], [kept, others])
  const rows = useMemo(() => rankRows.map((row) => {
    if (!others.length) return row
    const merged: Record<string, string | number> = { date: row.date }
    let othersTotal = 0
    for (const model of kept) merged[model] = row[model] ?? 0
    for (const model of others) othersTotal += Number(row[model] ?? 0)
    merged[OTHERS_KEY] = othersTotal
    return merged
  }), [rankRows, kept, others])
  // Token totals per date for the dual-axis line — the FULL daily total,
  // independent of legend hiding.
  const tokenTotals = useMemo(() => {
    const byDate = new Map<string, number>()
    for (const cell of data?.buckets ?? []) byDate.set(cell.date, (byDate.get(cell.date) ?? 0) + cell.tokens)
    return rows.map((row) => byDate.get(String(row.date)) ?? 0)
  }, [data, rows])
  const palette = useChartPalette(series.length)
  const visible = useMemo(() => series.filter((model) => model === OTHERS_KEY || !hidden.has(model)), [series, hidden])
  const lookup = useCallback((date: string, model: string): { quota: number, tokens: number } | null => {
    if (model === OTHERS_KEY) {
      let quota = 0
      let tokens = 0
      for (const cell of data?.buckets ?? []) {
        if (cell.date === date && others.includes(cell.model)) {
          quota += cell.quota
          tokens += cell.tokens
        }
      }
      return { quota: Number(quota.toFixed(4)), tokens }
    }
    const cell = (data?.buckets ?? []).find((bucket) => bucket.date === date && bucket.model === model)
    return cell ?? null
  }, [data, others])
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

  const leftMetric: 'cny' | 'tokens' = metric === 'tokens' ? 'tokens' : 'cny'

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
                {(['cny', 'tokens', 'dual'] as const).map((candidate) => (
                  <Pill
                    key={candidate}
                    active={metric === candidate}
                    onClick={() => setMetric(candidate)}
                  >
                    {candidate === 'cny' ? t('dashMetricCny') : candidate === 'tokens' ? t('dashMetricTokens') : t('dashMetricDual')}
                  </Pill>
                ))}
              </div>
            </div>
            {rows.length === 0 ? <div className="relay_empty">{t('dashEmpty')}</div> : (
              <>
                <StackedBarChart
                  rows={rows}
                  models={series}
                  visible={visible}
                  colors={palette}
                  metric={leftMetric}
                  dual={metric === 'dual'}
                  tokenTotals={metric === 'dual' ? tokenTotals : undefined}
                  yMax={yMax}
                  lookup={lookup}
                />
                <div className="relay_chartLegend">
                  {series.map((model, index) => model === OTHERS_KEY ? (
                    <span key={model} className="relay_chartLegendItem" title={others.join(', ')}>
                      <span className="relay_chartSwatch relay_chartOthers" />
                      {t('dashOthers')(others.length)}
                    </span>
                  ) : (
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
                  {metric === 'dual' && (
                    <span className="relay_chartLegendItem">
                      <svg width="18" height="10" aria-hidden="true"><path d="M1 5 H17" className="relay_chartLine" /></svg>
                      {t('dashTokensLine')}
                    </span>
                  )}
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}
