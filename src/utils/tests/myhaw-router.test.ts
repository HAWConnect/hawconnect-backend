import { expect, test } from 'bun:test'
import http from 'node:http'
import express from 'express'
import { createMyHawCalendarRouter } from '../../lib/myhaw-calendar-router'

test('bounds downloads even when requests arrive with overlapping partial bodies', async () => {
    let downloads = 0
    let release: () => void = () => {}
    const hold = new Promise<void>((resolve) => {
        release = resolve
    })
    const app = express()
    app.use(
        '/import',
        createMyHawCalendarRouter(async () => {
            downloads++
            await hold
            return 'BEGIN:VCALENDAR\r\nEND:VCALENDAR'
        })
    )
    const server = app.listen(0, '127.0.0.1')
    await new Promise<void>((resolve) => server.once('listening', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw Error('No server')
    const body = JSON.stringify({
        url: 'https://myhaw.haw-hamburg.de/qisserver/pages/cm/exa/timetable/individualTimetableCalendarExport.faces?user=test&hash=test'
    })
    const requests: http.ClientRequest[] = []
    const statuses: number[] = []
    const completions = Array.from(
        { length: 9 },
        () =>
            new Promise<void>((resolve, reject) => {
                const req = http.request(
                    {
                        host: '127.0.0.1',
                        port: address.port,
                        path: '/import',
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Content-Length': Buffer.byteLength(body)
                        }
                    },
                    (res) => {
                        statuses.push(res.statusCode ?? 0)
                        res.resume()
                        res.once('end', resolve)
                    }
                )
                req.once('error', reject)
                req.write(body.slice(0, 1))
                requests.push(req)
            })
    )
    try {
        await new Promise((resolve) => setTimeout(resolve, 50))
        for (const req of requests) req.end(body.slice(1))
        for (let i = 0; i < 100 && !statuses.includes(429); i++)
            await new Promise((resolve) => setTimeout(resolve, 10))
        expect(downloads).toBe(8)
        expect(statuses).toContain(429)
    } finally {
        release()
        await Promise.all(completions)
        await new Promise<void>((resolve) => server.close(() => resolve()))
    }
})
