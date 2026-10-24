import ICAL from 'ical.js'

export type SyncKind = 'calendar' | 'preference' | 'bookmark' | 'dashboard'
export interface SyncOperation {
    operationId: string
    kind: SyncKind
    entityId: string
    baseRevision: number
    deleted: boolean
    payload: unknown
}
export interface SyncRecord {
    kind: SyncKind
    entityId: string
    revision: number
    deleted: boolean
    payload: unknown
}
const identifier = /^[a-zA-Z0-9._:-]{1,128}$/
const object = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === 'object' && !Array.isArray(value)
const strings = (value: unknown, limit = 64) =>
    Array.isArray(value) &&
    value.length <= limit &&
    value.every((v) => typeof v === 'string' && v.length <= 128)
const preferences: Record<string, (v: unknown) => boolean> = {
    language: (v) => typeof v === 'string' && ['de', 'en'].includes(v),
    theme: (v) =>
        typeof v === 'string' && ['auto', 'light', 'dark'].includes(v),
    themeColor: (v) =>
        typeof v === 'string' && ['blue', 'green', 'purple'].includes(v),
    autoShowNextDay: (v) => typeof v === 'boolean',
    autoShowNextDayTimeMinutes: (v) =>
        Number.isInteger(v) && Number(v) >= 0 && Number(v) < 1440,
    recentQuicklinks: (v) => strings(v, 3),
    'food.selectedRestaurants': (v) =>
        strings(v, 3) &&
        (v as string[]).every((id) =>
            ['BerlinerTorMensa', 'BergedorfMensa', 'FinkenauMensa'].includes(id)
        ),
    'food.preferencesSelection': (v) => strings(v),
    'food.allergenSelection': (v) => strings(v),
    'food.showStatic': (v) => typeof v === 'boolean',
    'food.foodLanguage': (v) =>
        typeof v === 'string' && ['default', 'de', 'en'].includes(v)
}
export function validateSyncOperations(input: unknown): SyncOperation[] {
    try {
        if (
            !Array.isArray(input) ||
            input.length > 20 ||
            Buffer.byteLength(JSON.stringify(input)) > 4_500_000
        )
            throw new Error()
        return input.map((value) => {
            if (
                !object(value) ||
                Object.keys(value).some(
                    (k) =>
                        ![
                            'operationId',
                            'kind',
                            'entityId',
                            'baseRevision',
                            'deleted',
                            'payload'
                        ].includes(k)
                )
            )
                throw new Error()
            const {
                operationId,
                kind,
                entityId,
                baseRevision,
                deleted,
                payload
            } = value
            if (
                typeof operationId !== 'string' ||
                !identifier.test(operationId) ||
                typeof entityId !== 'string' ||
                !identifier.test(entityId) ||
                !Number.isSafeInteger(baseRevision) ||
                Number(baseRevision) < 0 ||
                typeof deleted !== 'boolean' ||
                typeof kind !== 'string' ||
                !['calendar', 'preference', 'bookmark', 'dashboard'].includes(
                    kind
                )
            )
                throw new Error()
            if (deleted) {
                if (payload !== null) throw new Error()
            } else if (kind === 'calendar') {
                if (
                    !object(payload) ||
                    Object.keys(payload).some(
                        (k) =>
                            ![
                                'raw',
                                'name',
                                'eventCount',
                                'defaultTimeZone',
                                'sourceType',
                                'updatedAt',
                                'privateLink',
                                'guestImport'
                            ].includes(k)
                    )
                )
                    throw new Error()
                if (
                    typeof payload.name !== 'string' ||
                    !payload.name.trim() ||
                    payload.name.length > 256 ||
                    typeof payload.raw !== 'string' ||
                    Buffer.byteLength(payload.raw) > 2_000_000 ||
                    typeof payload.defaultTimeZone !== 'string' ||
                    typeof payload.sourceType !== 'string' ||
                    !['file', 'link', 'demo'].includes(payload.sourceType) ||
                    typeof payload.updatedAt !== 'string' ||
                    !Number.isFinite(Date.parse(payload.updatedAt))
                )
                    throw new Error()
                new Intl.DateTimeFormat('en', {
                    timeZone: payload.defaultTimeZone
                }).format()
                const calendar = new ICAL.Component(ICAL.parse(payload.raw))
                const events = calendar.getAllSubcomponents('vevent')
                if (
                    calendar.name !== 'vcalendar' ||
                    events.length === 0 ||
                    events.length > 5000 ||
                    payload.eventCount !==
                        new Set(
                            events.map(
                                (event) =>
                                    `${event.getFirstPropertyValue('uid')}\u0000${event.getFirstPropertyValue('recurrence-id') ?? ''}`
                            )
                        ).size ||
                    events.some(
                        (e) =>
                            !e.getFirstPropertyValue('uid') ||
                            !e.hasProperty('dtstart')
                    )
                )
                    throw new Error()
                if (payload.guestImport !== undefined) {
                    const source = payload.guestImport
                    if (
                        !object(source) ||
                        Object.keys(source).some(
                            (k) =>
                                ![
                                    'installationId',
                                    'guestEntityId',
                                    'guestRevision',
                                    'importedRevision'
                                ].includes(k)
                        ) ||
                        typeof source.installationId !== 'string' ||
                        !identifier.test(source.installationId) ||
                        typeof source.guestEntityId !== 'string' ||
                        !identifier.test(source.guestEntityId) ||
                        typeof source.guestRevision !== 'string' ||
                        !/^[a-f0-9]{64}$/.test(source.guestRevision) ||
                        !Number.isSafeInteger(source.importedRevision) ||
                        Number(source.importedRevision) < 1
                    )
                        throw new Error()
                }
                if (payload.privateLink !== undefined) {
                    if (
                        typeof payload.privateLink !== 'string' ||
                        payload.privateLink.length > 4096
                    )
                        throw new Error()
                    const link = new URL(payload.privateLink)
                    if (
                        link.protocol !== 'https:' ||
                        link.username ||
                        link.password ||
                        payload.sourceType !== 'link'
                    )
                        throw new Error()
                }
                if (payload.sourceType === 'link' && !payload.privateLink)
                    throw new Error()
            } else if (kind === 'preference') {
                if (!preferences[entityId]?.(payload)) throw new Error()
            } else if (kind === 'bookmark') {
                if (
                    !object(payload) ||
                    Object.keys(payload).some((k) => !['key'].includes(k)) ||
                    typeof payload.key !== 'string' ||
                    !identifier.test(payload.key)
                )
                    throw new Error()
            } else if (
                !object(payload) ||
                Object.keys(payload).some(
                    (k) => !['shown', 'unavailable'].includes(k)
                ) ||
                !strings(payload.shown, 32) ||
                !strings(payload.unavailable, 32)
            )
                throw new Error()
            return {
                operationId,
                kind: kind as SyncKind,
                entityId,
                baseRevision: Number(baseRevision),
                deleted,
                payload
            }
        })
    } catch {
        throw new Error('InvalidSyncPayload')
    }
}
