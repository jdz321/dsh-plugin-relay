import { describe, expect, it } from 'vitest'

import {
  linePath,
  linePoints,
  niceScale,
  OTHERS_KEY,
  pivotBuckets,
  stackedColumns,
  TOP_N,
  topSeries,
  xLabelIndices,
  type UsageBucket,
} from '../src/client/dashboard-chart.js'

describe('niceScale (Y ticks: 4-6, integers from 1 up)', () => {
  it('picks 1-2-5 steps that cover the max', () => {
    expect(niceScale(400)).toEqual({ max: 400, ticks: [0, 100, 200, 300, 400] })
    expect(niceScale(550)).toEqual({ max: 600, ticks: [0, 200, 400, 600] })
    expect(niceScale(80)).toEqual({ max: 80, ticks: [0, 20, 40, 60, 80] })
  })

  it('stays integer for token-scale data', () => {
    const scale = niceScale(1_048_576)
    expect(scale.max).toBeGreaterThanOrEqual(1_048_576)
    for (const tick of scale.ticks) expect(Number.isInteger(tick)).toBe(true)
    expect(scale.ticks[0]).toBe(0)
    expect(scale.ticks.length).toBeGreaterThanOrEqual(4)
    expect(scale.ticks.length).toBeLessThanOrEqual(6)
  })

  it('handles zero and tiny data without dividing by zero', () => {
    expect(niceScale(0).ticks).toEqual([0, 0.25, 0.5, 0.75, 1])
    const tiny = niceScale(0.04)
    expect(tiny.max).toBeGreaterThanOrEqual(0.04)
    expect(tiny.ticks.length).toBeGreaterThanOrEqual(4)
  })

  it('every tick lands within [0, max] and max ≥ the data max', () => {
    for (const maxValue of [1, 7, 33, 999, 12_345, 999_999]) {
      const scale = niceScale(maxValue)
      expect(scale.max).toBeGreaterThanOrEqual(maxValue)
      expect(scale.ticks.at(-1)).toBe(scale.max)
    }
  })
})

describe('xLabelIndices (date-label thinning)', () => {
  it('keeps every label when they all fit', () => {
    expect(xLabelIndices(7, 10)).toEqual([0, 1, 2, 3, 4, 5, 6])
  })

  it('thins with an even stride when they do not', () => {
    expect(xLabelIndices(30, 10)).toEqual([0, 3, 6, 9, 12, 15, 18, 21, 24, 27])
    expect(xLabelIndices(14, 5)).toEqual([0, 3, 6, 9, 12])
  })

  it('degenerate inputs stay safe', () => {
    expect(xLabelIndices(0, 5)).toEqual([])
    expect(xLabelIndices(3, 0)).toEqual([0])
  })
})

describe('stackedColumns (pixel geometry)', () => {
  const rows = [
    { date: '09-01', a: 100, b: 50 },
    { date: '09-02', a: 200, b: 0 },
  ]

  it('stacks segments bottom-up and skips zero segments', () => {
    const columns = stackedColumns({ rows, models: ['a', 'b'], width: 200, height: 300, yMax: 300 })
    expect(columns).toHaveLength(2)
    const first = columns[0]!
    expect(first.segments).toHaveLength(2)
    const [a, b] = first.segments
    // a sits at the bottom (y = 300-100 = 200), b stacked on top (y = 300-150 = 150)
    expect(a!.y).toBe(200)
    expect(a!.height).toBe(100)
    expect(b!.y).toBe(150)
    expect(b!.height).toBe(50)
    // columns share the width; bars keep a gap inside their band
    expect(first.width).toBeLessThan(100)
    expect(first.x).toBeGreaterThanOrEqual(0)
    // zero value → no segment
    expect(columns[1]!.segments).toHaveLength(1)
    expect(columns[1]!.total).toBe(200)
  })

  it('scales against yMax, not the data max', () => {
    const columns = stackedColumns({ rows, models: ['a'], width: 100, height: 100, yMax: 400 })
    expect(columns[0]!.segments[0]!.height).toBe(25)
  })

  it('degenerates safely', () => {
    expect(stackedColumns({ rows: [], models: ['a'], width: 100, height: 100, yMax: 100 })).toEqual([])
    expect(stackedColumns({ rows, models: [], width: 100, height: 100, yMax: 100 })).toEqual([])
    expect(stackedColumns({ rows, models: ['a'], width: 0, height: 100, yMax: 100 })).toEqual([])
  })
})

describe('linePath / linePoints (dual-axis token line geometry)', () => {
  it('centers each vertex in its band and scales against yMax', () => {
    const path = linePath([0, 100, 200], 300, 100, 200)
    // bands of 100 → centers at 50 / 150 / 250; y = 100 - value * 0.5
    expect(path).toBe('M50,100 L150,50 L250,0')
    expect(linePoints([0, 100, 200], 300, 100, 200)).toEqual([
      { x: 50, y: 100 },
      { x: 150, y: 50 },
      { x: 250, y: 0 },
    ])
  })

  it('clamps negative values at the baseline', () => {
    expect(linePath([-5, 5], 100, 100, 100)).toBe('M25,100 L75,95')
  })

  it('degenerates safely', () => {
    expect(linePath([], 100, 100, 100)).toBe('')
    expect(linePath([1], 0, 100, 100)).toBe('')
    expect(linePath([1], 100, 100, 0)).toBe('')
    expect(linePoints([], 100, 100, 100)).toEqual([])
  })
})

describe('topSeries + pivotBuckets (Top-N fold with stable ranking)', () => {
  const buckets: UsageBucket[] = []
  // 9 models; totals over 2 days: m1=30, m2=21, m3=12, tie=10, m4=3, m5=2, m6=1, m7=0, m8=0
  const totals: Record<string, number> = { m1: 30, m2: 21, m3: 12, 'tie-a': 10, 'tie-b': 10, m4: 3, m5: 2, m6: 1, m7: 0, m8: 0 }
  for (const [model, total] of Object.entries(totals)) {
    buckets.push({ date: '2026-09-01', model, quota: total / 2, tokens: total })
    buckets.push({ date: '2026-09-02', model, quota: total / 2, tokens: total })
  }

  it('keeps the top N by window total and merges the rest', () => {
    const { rows, models } = pivotBuckets(buckets, 'cny')
    expect(models).toHaveLength(10)
    const { kept, others } = topSeries(models, rows, 3)
    expect(kept).toEqual(['m1', 'm2', 'm3'])
    expect(others.sort()).toEqual(['m4', 'm5', 'm6', 'm7', 'm8', 'tie-a', 'tie-b'])
  })

  it('breaks total ties by name ascending (stable fold)', () => {
    const { rows, models } = pivotBuckets(buckets, 'cny')
    const { kept, others } = topSeries(models, rows, 4)
    // tie-a and tie-b share 10; tie-a wins the 4th slot by name
    expect(kept).toEqual(['m1', 'm2', 'm3', 'tie-a'])
    expect(others).toContain('tie-b')
  })

  it('the default N is TOP_N (7) and fewer models fold nothing', () => {
    const { rows, models } = pivotBuckets(buckets, 'cny')
    const { kept, others } = topSeries(models, rows)
    expect(TOP_N).toBe(7)
    expect(kept).toHaveLength(7)
    expect(others).toHaveLength(3)
    const small = topSeries(['a', 'b'], [{ a: 1, b: 2 }], 7)
    expect(small.others).toEqual([])
  })

  it('pivotBuckets: token metric reads tokens, cny rounds quota to 4 decimals', () => {
    const { rows: cnyRows, models } = pivotBuckets([{ date: 'd', model: 'x', quota: 0.123456, tokens: 5 }], 'cny')
    expect(models).toEqual(['x'])
    expect(Number(cnyRows[0]!.x)).toBe(0.1235)
    const { rows: tokenRows } = pivotBuckets([{ date: 'd', model: 'x', quota: 0.123456, tokens: 5 }], 'tokens')
    expect(tokenRows[0]!.x).toBe(5)
    // dual ranks on spend (the bars' axis)
    expect(pivotBuckets([{ date: 'd', model: 'x', quota: 1, tokens: 999 }], 'dual').rows[0]!.x).toBe(1)
  })

  it('OTHERS_KEY is never a plausible model id', () => {
    expect(OTHERS_KEY).toBe('__others__')
  })
})
