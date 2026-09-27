import { describe, expect, it } from 'vitest'

import { niceScale, stackedColumns, xLabelIndices } from '../src/client/dashboard-chart.js'

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
