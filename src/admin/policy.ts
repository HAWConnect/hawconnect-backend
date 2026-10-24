export const capabilities = [
    'announcements',
    'events',
    'ops',
    'audit',
    'admin'
] as const
export type Capability = (typeof capabilities)[number]
export function adminEmail(value: string): string {
    const email = value.trim().toLowerCase()
    if (
        !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@haw-hamburg\.de$/.test(email) ||
        email.length > 254
    )
        throw Error('InvalidAdminEmail')
    return email
}
export function capabilitiesFor(
    email: string,
    bootstrap: string[],
    delegated: string[]
): Capability[] {
    const address = adminEmail(email)
    return bootstrap.includes(address)
        ? ['admin']
        : capabilities.filter((c) => delegated.includes(c))
}
export function requireCapability(grants: Capability[], required: Capability) {
    if (!grants.includes('admin') && !grants.includes(required))
        throw Error('Forbidden')
}
