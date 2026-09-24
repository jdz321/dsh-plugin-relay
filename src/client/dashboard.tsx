/**
 * The 「数据看板」 tab: balance / today / totals cards plus a stacked
 * per-model bar chart of the last N days, with a 消耗金额 / Token 量 metric
 * toggle. Charts come from recharts (bundled into the client artifact;
 * react stays external). The chart palette is read from the shell's design
 * tokens at render time with fixed fallbacks.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Button, Pill } from '@deepseek-ai/dsh-client-ui-primitives'

import { apiGet } from './api.js'
import { tokenCountText, type Translator } from './locale.js'

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

export interface DashboardViewProps {
  t: Translator
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

export function DashboardTab({ t }: DashboardViewProps): JSX.Element {
  const [data, setData] = useState<DashboardData | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [metric, setMetric] = useState<Metric>('cny')

  const refresh = useCallback((): void => {
    setLoading(true)
    apiGet('/api/relay/dashboard?days=7')
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
  }, [])
  useEffect(() => {
    refresh()
  }, [refresh])

  const { rows, models } = useMemo(() => pivotBuckets(data?.buckets ?? [], metric), [data, metric])
  const palette = useChartPalette(models.length)

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
        <Button variant="ghost" size="sm" disabled={loading} onClick={refresh}>
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
            {rows.length === 0 ? <div className="relay_empty">{t('dashEmpty')}</div> : (
              <div className="relay_chart">
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--dsw-alias-border-l4, #333)" />
                    <XAxis dataKey="date" tickMargin={4} />
                    <YAxis width={52} tickFormatter={(value: number) => (metric === 'cny' ? `¥${value}` : tokenCountText(value))} />
                    <Tooltip />
                    <Legend />
                    {models.map((model, index) => (
                      <Bar key={model} dataKey={model} stackId="usage" fill={palette[index % palette.length]!} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
