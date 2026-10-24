import type { Request as ExpressRequest } from 'express'
/** Only documented admin auth actions are dispatched; no inbound cookies or redirect URLs are forwarded. */
export function toWebRequest(
    req: ExpressRequest,
    origin: string,
    action: string,
    body: unknown,
    token?: string
): Request {
    const headers = new Headers({
        'Content-Type': 'application/json',
        Origin: origin,
        'X-HAWConnect-Client': 'native',
        'X-HAWConnect-Client-Ip': req.ip ?? 'unknown'
    })
    if (token) headers.set('Authorization', `Bearer ${token}`)
    return new Request(`http://internal/api/accounts/${action}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
    })
}
