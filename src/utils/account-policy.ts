/** HAWConnect accounts verify mailbox ownership, not university enrolment. */
export function normaliseAccountEmail(input: string): string {
    const email = input.trim().toLowerCase()
    const parts = email.split('@')
    const local = parts[0]
    if (
        email.length > 254 ||
        parts.length !== 2 ||
        parts[1] !== 'haw-hamburg.de' ||
        !local ||
        local.length > 64 ||
        !/^[a-z0-9!#$%&'*+/=?^_`{|}~.-]+$/.test(local) ||
        local.startsWith('.') ||
        local.endsWith('.') ||
        local.includes('..')
    )
        throw new Error('InvalidAccountEmail')
    return email
}
