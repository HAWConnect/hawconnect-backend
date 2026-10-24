import nodemailer from 'nodemailer'
import type { AccountMail } from './account-auth'

/** No default sender, token console output, or successful development mail stub. */
export function createAccountMailer(
    env: NodeJS.ProcessEnv = process.env
): ((message: AccountMail) => Promise<void>) | undefined {
    if (!env.HAWCONNECT_SMTP_HOST || !env.HAWCONNECT_MAIL_FROM) return undefined
    const port = Number(env.HAWCONNECT_SMTP_PORT ?? 587)
    if (!Number.isInteger(port) || port < 1 || port > 65535)
        throw new Error('InvalidMailConfiguration')
    if (
        Boolean(env.HAWCONNECT_SMTP_USER) !==
        Boolean(env.HAWCONNECT_SMTP_PASSWORD)
    )
        throw new Error('InvalidMailConfiguration')
    const transport = nodemailer.createTransport({
        host: env.HAWCONNECT_SMTP_HOST,
        port,
        secure: port === 465,
        requireTLS: port !== 465,
        ...(env.HAWCONNECT_SMTP_USER
            ? {
                  auth: {
                      user: env.HAWCONNECT_SMTP_USER,
                      pass: env.HAWCONNECT_SMTP_PASSWORD
                  }
              }
            : {}),
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 15000,
        logger: false,
        debug: false
    })
    return async ({ email, url }) => {
        const result = await transport.sendMail({
            from: env.HAWCONNECT_MAIL_FROM,
            to: email,
            subject: 'HAWConnect · Anmelden / Sign in',
            text: `Melde dich bei HAWConnect an / Sign in to HAWConnect:\n\n${url}\n\nDieser Link ist 10 Minuten gültig und kann einmal verwendet werden.\nThis link expires in 10 minutes and can be used once.\n\nNicht angefordert? Ignoriere diese E-Mail.\nDid not request this? Ignore this email.`
        })
        if (!result.accepted?.length || result.rejected?.length)
            throw new Error('MailDeliveryFailed')
    }
}
