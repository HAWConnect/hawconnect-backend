import { describe, expect, test } from 'bun:test'
import { validateSyncOperations } from '../sync-validation'

const operation = (payload: unknown) => [
    {
        operationId: 'test',
        kind: 'preference',
        entityId: 'language',
        baseRevision: 0,
        deleted: false,
        payload
    }
]
describe('sync preference validation', () => {
    test('rejects coercible non-string preferences', () => {
        expect(() => validateSyncOperations(operation(['de']))).toThrow(
            'InvalidSyncPayload'
        )
    })
    test('accepts supported string preferences', () => {
        expect(validateSyncOperations(operation('de'))[0]?.payload).toBe('de')
    })
})
test('accepts a calendar whose duplicate event versions are deduplicated by the app', () => {
    const event =
        'BEGIN:VEVENT\r\nUID:one\r\nDTSTART:20261023T100000Z\r\nDTEND:20261023T110000Z\r\nEND:VEVENT\r\n'
    const payload = {
        name: 'Calendar',
        raw:
            'BEGIN:VCALENDAR\r\nVERSION:2.0\r\n' +
            event +
            event +
            'END:VCALENDAR\r\n',
        eventCount: 1,
        defaultTimeZone: 'Europe/Berlin',
        sourceType: 'file',
        updatedAt: '2026-10-23T12:00:00Z'
    }
    expect(
        validateSyncOperations([
            {
                operationId: 'calendar',
                kind: 'calendar',
                entityId: 'one',
                baseRevision: 0,
                deleted: false,
                payload
            }
        ])
    ).toHaveLength(1)
})
