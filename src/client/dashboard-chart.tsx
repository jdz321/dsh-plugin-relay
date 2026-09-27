/**
 * Hand-written SVG stacked bar chart for the dashboard (v0.6.0) — replaces
 * recharts, whose dependency tree was ~78% of the client bundle for exactly
 * one chart. One color per model (the shell's design-token palette), integer
 * Y ticks, date X labels thinned to fit, native <title> hover tips, and
 * legend-driven series visibility handled by the parent (pure client-side
 * filtering). The layout math is extracted into pure, unit-tested functions.
 */

import { useLayoutEffect, useRef, useState } from 'react'

import { tokenCountText } from './locale.js'
import { trimNum } from './format.js'

/** Y scale of the chart: nice ticks from 0 to a value ≥ maxValue. */
export interface ChartScale {
  max: number
  ticks: number[]
}

/**
 * Classic 1-2-5 nice-step scale with 4-6 ticks. Steps below 1 stay decimal
 * (tiny CNY datasets would render empty bars against an integer-only axis);
 * from 1 upward every tick is an integer.
 */
export function niceScale(maxValue: number, tickCount = 5): ChartScale {
  if (!(maxValue > 0)) return { max: 1, ticks: [0, 0.25, 0.5, 0.75, 1] }
  const target = Math.max(maxValue, 0) / Math.max(1, tickCount - 1)
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(target, 1e-9)))
  let step = 10 * magnitude
  for (const m of [1, 2, 5, 10]) {
    if (m * magnitude >= target) {
      step = m * magnitude
      break
    }
  }
  const max = step * Math.max(1, Math.ceil(Math.max(maxValue, 0) / step))
  const count = Math.round(max / step)
  const ticks = Array.from({ length: count + 1 }, (_, i) => Number((i * step).toFixed(6)))
  return { max, ticks }
}

/** Which X labels to draw when `count` labels must fit `maxLabels` slots. */
export function xLabelIndices(count: number, maxLabels: number): number[] {
  if (count <= 0) return []
  if (count <= maxLabels) return Array.from({ length: count }, (_, i) => i)
  const step = Math.ceil(count / maxLabels)
  return Array.from({ length: count }, (_, i) => i).filter((i) => i % step === 0)
}

/** Geometry of one stacked segment (SVG pixel rect + its value). */
export interface BarSegment {
  model: string
  value: number
  x: number
  y: number
  width: number
  height: number
}

/** Geometry of one date column (a stack of segments bottom-up). */
export interface BarColumn {
  date: string
  total: number
  x: number
  width: number
  segments: BarSegment[]
}

/** Compute the pixel geometry of the stacked columns. Pure. */
export function stackedColumns(opts: {
  /** One row per date: `{ date, <model>: value }` — only visible models. */
  rows: readonly Record<string, unknown>[]
  /** Visible models in stack order (bottom-up). */
  models: readonly string[]
  /** Plot-area pixel size. */
  width: number
  height: number
  /** Top of the Y scale (from niceScale). */
  yMax: number
  /** Gap between adjacent columns as a fraction of the band (default 0.3). */
  gap?: number
}): BarColumn[] {
  const { rows, models, width, height, yMax } = opts
  const gap = opts.gap ?? 0.3
  if (!rows.length || !models.length || width <= 0 || height <= 0 || yMax <= 0) return []
  const band = width / rows.length
  const barWidth = Math.max(1, band * (1 - gap))
  const pxPerUnit = height / yMax
  return rows.map((row, index) => {
    let cumulative = 0
    const segments: BarSegment[] = []
    for (const model of models) {
      const value = Number(row[model] ?? 0)
      if (!(value > 0)) continue
      const segmentHeight = value * pxPerUnit
      segments.push({
        model,
        value,
        x: index * band + (band - barWidth) / 2,
        y: height - (cumulative + value) * pxPerUnit,
        width: barWidth,
        height: segmentHeight,
      })
      cumulative += value
    }
    return { date: String(row.date ?? ''), total: cumulative, x: index * band + (band - barWidth) / 2, width: barWidth, segments }
  })
}

/** Measure a container's content width (ResizeObserver, SSR-safe). */
function useContainerWidth(fallback = 640): [React.RefObject<HTMLDivElement>, number] {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(fallback)
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const update = (): void => setWidth(Math.max(240, Math.floor(element.clientWidth)))
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return [ref, width]
}

export interface StackedBarChartProps {
  rows: readonly Record<string, unknown>[]
  /** All models (legend order); `visible` filters what renders. */
  models: readonly string[]
  visible: readonly string[]
  colors: readonly string[]
  metric: 'cny' | 'tokens'
  height?: number
  /** Y-axis max — recomputed by the parent whenever visibility changes. */
  yMax: number
  /** Both metrics per cell, for the hover tip (`模型 · 日期 · ¥x / N tok`). */
  lookup: (date: string, model: string) => { quota: number, tokens: number } | null
}

const CHART_HEIGHT = 220
const Y_LABEL_WIDTH = 52
const X_LABEL_HEIGHT = 20

/** One Y tick label: `¥N` for spend, tokenCountText for tokens. */
function yTickLabel(value: number, metric: 'cny' | 'tokens'): string {
  return metric === 'cny' ? `¥${trimNum(value)}` : tokenCountText(value)
}

export function StackedBarChart({ rows, models, visible, colors, metric, height = CHART_HEIGHT, yMax, lookup }: StackedBarChartProps): JSX.Element {
  const [containerRef, containerWidth] = useContainerWidth()
  const plotWidth = Math.max(1, containerWidth - Y_LABEL_WIDTH)
  const plotHeight = Math.max(1, height - X_LABEL_HEIGHT)
  const scale = niceScale(yMax)
  const columns = stackedColumns({
    rows,
    models: visible,
    width: plotWidth,
    height: plotHeight,
    yMax: scale.max,
  })
  const labelSlots = Math.max(2, Math.floor(plotWidth / 64))
  const drawnLabels = new Set(xLabelIndices(rows.length, labelSlots))
  const colorOf = new Map(models.map((model, index) => [model, colors[index % colors.length]!]))

  return (
    <div className="relay_chart" ref={containerRef}>
      <svg width={containerWidth} height={height} role="img" aria-hidden="true">
        {scale.ticks.map((tick) => {
          const y = plotHeight - tick * (plotHeight / scale.max)
          return (
            <g key={tick}>
              <line x1={Y_LABEL_WIDTH} x2={containerWidth} y1={y} y2={y} className="relay_chartGrid" />
              <text x={Y_LABEL_WIDTH - 6} y={y + 3} textAnchor="end" className="relay_chartText">
                {yTickLabel(tick, metric)}
              </text>
            </g>
          )
        })}
        {columns.map((column, columnIndex) => (
          <g key={column.date || columnIndex}>
            {column.segments.map((segment) => {
              const detail = lookup(column.date, segment.model)
              const tip = `${segment.model} · ${column.date} · ¥${trimNum(detail?.quota ?? 0)} / ${tokenCountText(detail?.tokens ?? 0)} tok`
              return (
                <rect
                  key={segment.model}
                  x={Y_LABEL_WIDTH + segment.x}
                  y={segment.y}
                  width={segment.width}
                  height={Math.max(1, segment.height)}
                  fill={colorOf.get(segment.model) ?? '#5b8fd9'}
                  className="relay_chartBar"
                >
                  <title>{tip}</title>
                </rect>
              )
            })}
            {drawnLabels.has(columnIndex) && (
              <text
                x={Y_LABEL_WIDTH + column.x + column.width / 2}
                y={plotHeight + 14}
                textAnchor="middle"
                className="relay_chartText"
              >
                {column.date.slice(5)}
              </text>
            )}
          </g>
        ))}
      </svg>
    </div>
  )
}
