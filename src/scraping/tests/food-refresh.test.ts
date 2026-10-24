import { expect, it } from 'bun:test'
import { combineFoodWeeks, createFoodService } from '../../utils/food-refresh'

it('coalesces concurrent refresh and preserves last-good data after failure', async () => {
    let requests = 0
    let fail = false
    let disk: unknown = null
    const service = createFoodService({
        fetchSnapshot: async () => {
            requests++
            if (fail) throw Error('offline')
            return {
                foodData: [{ timestamp: '2026-10-19', meals: [] }],
                translationFallback: false,
                errors: []
            }
        },
        read: async () => disk,
        write: async (value) => {
            disk = value
        },
        now: () => new Date('2026-10-19T12:00:00Z')
    })
    await Promise.all([service.refresh(), service.refresh()])
    expect(requests).toBe(1)
    fail = true
    await service.refresh()
    const result = await service.get()
    expect(result.stale).toBe(true)
    expect(result.updatedAt).toBe('2026-10-19T12:00:00.000Z')
    expect(result.foodData).toHaveLength(1)
})
it('restores persisted data after a process restart', async () => {
    const disk = {
        foodData: [{ timestamp: '2026-10-19', meals: [] }],
        translationFallback: false,
        errors: [],
        updatedAt: '2026-10-19T12:00:00Z'
    }
    const service = createFoodService({
        fetchSnapshot: async () => {
            throw Error()
        },
        read: async () => disk,
        write: async () => {},
        now: () => new Date('2026-10-19T13:00:00Z')
    })
    expect((await service.get()).foodData).toHaveLength(1)
})
it('does not publish a candidate when durable storage fails', async () => {
    const service = createFoodService({
        fetchSnapshot: async () => ({
            foodData: [],
            translationFallback: false,
            errors: []
        }),
        read: async () => null,
        write: async () => {
            throw Error('disk full')
        },
        now: () => new Date()
    })
    await service.refresh()
    expect((await service.get()).available).toBe(false)
})

it('merges published weeks in date order and deduplicates overlapping days', () => {
    const day = { timestamp: '2026-10-23', meals: [] }
    const result = combineFoodWeeks(
        { foodData: [day], translationFallback: false, errors: [] },
        {
            foodData: [{ timestamp: '2026-10-26', meals: [] }, day],
            translationFallback: true,
            errors: []
        }
    )
    expect(result.foodData.map((day) => day.timestamp)).toEqual([
        '2026-10-23',
        '2026-10-26'
    ])
    expect(result.translationFallback).toBe(true)
})

it('retains independent English menus when combining current and next weeks', () => {
    const current = {
        foodData: [],
        englishFoodData: [{ timestamp: '2026-10-23', meals: [] }],
        translationFallback: false,
        errors: []
    }
    const next = {
        foodData: [],
        englishFoodData: [{ timestamp: '2026-10-26', meals: [] }],
        translationFallback: false,
        errors: []
    }
    expect(
        combineFoodWeeks(current, next).englishFoodData?.map(
            (day) => day.timestamp
        )
    ).toEqual(['2026-10-23', '2026-10-26'])
})
