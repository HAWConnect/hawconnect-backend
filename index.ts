import { readFileSync } from 'node:fs'
import path from 'node:path'
import { ApolloServer } from '@apollo/server'
import {
    ApolloServerPluginLandingPageLocalDefault,
    ApolloServerPluginLandingPageProductionDefault
} from '@apollo/server/plugin/landingPage/default'
import { expressMiddleware } from '@as-integrations/express5'
import { fromNodeHeaders, toNodeHandler } from 'better-auth/node'
import cors from 'cors'
import express from 'express'
import NodeCache from 'node-cache'
import { getAccountOwner } from '@/lib/account-auth'
import { accountRuntime } from '@/lib/account-runtime'
import { createAdminRouter } from './src/admin/router'
import { createAdminRuntime } from './src/admin/runtime'
import { createPublicLegalRouter } from './src/lib/legal-router'
import { myHawCalendarRouter } from './src/lib/myhaw-calendar-router'
import { resolvers } from './src/resolvers'
import { startAcademicCalendarRefresh } from './src/utils/academic-calendar'
import { startFoodRefresh } from './src/utils/food-refresh'
import { startHawEventsRefresh } from './src/utils/haw-events'

const schemaFiles = [
    'enums.gql',
    'scalars.gql',
    'types.gql',
    'inputs.gql',
    'schema.gql'
]
const schemaDir = path.join(__dirname, 'src', 'schema')

const typeDefs = schemaFiles.map((file) => {
    const filePath = path.join(schemaDir, file)
    try {
        return readFileSync(filePath, { encoding: 'utf-8' })
    } catch (error) {
        console.error(`Error reading file ${filePath}:`, error)
        throw error
    }
})
const port = process.env.PORT || 4000

const app = express()
app.use(
    cors({
        credentials: true,
        origin: (
            process.env.HAWCONNECT_WEB_ORIGINS ??
            'http://localhost:3000,http://localhost:3001,http://localhost:8081'
        )
            .split(',')
            .map((origin) => origin.trim())
            .filter(Boolean)
    })
)

app.use('/api/admin', createAdminRouter(createAdminRuntime()))

app.use('/api/calendar/myhaw', myHawCalendarRouter)
app.use('/api/legal', createPublicLegalRouter(accountRuntime?.pool ?? null))

// Only our bounded, domain-restricted wrapper is public. Never expose raw /api/auth routes.
app.all('/api/accounts/*path', (req, res, next) => {
    req.headers['x-hawconnect-client-ip'] = req.ip ?? 'unknown'
    if (!accountRuntime) {
        res.status(503)
            .set('Cache-Control', 'no-store')
            .json({ error: 'AccountUnavailable' })
        return
    }
    void toNodeHandler(accountRuntime.handler)(req, res).catch(next)
})

const apolloServer = new ApolloServer({
    typeDefs,
    resolvers,
    plugins: [
        Bun.env.NODE_ENV === 'production'
            ? ApolloServerPluginLandingPageProductionDefault({
                  footer: false
              })
            : ApolloServerPluginLandingPageLocalDefault()
    ],
    introspection: true,
    formatError(formattedError, error) {
        // Do not print variables, tokens or personal calendar payloads.
        if (error instanceof Error && process.env.NODE_ENV !== 'test')
            console.error('GraphQL request failed')
        return formattedError
    }
})

export const cache = new NodeCache({
    stdTTL: 60 * 10,
    maxKeys: 1000,
    checkperiod: 60,
    useClones: false,
    deleteOnExpire: true
})
await apolloServer.start()

app.use(
    '/graphql',
    express.json({ limit: '5mb' }),
    expressMiddleware(apolloServer, {
        context: async ({ req }): Promise<{ accountUserId?: string }> => {
            if (
                !accountRuntime ||
                (!req.headers.cookie && !req.headers.authorization)
            )
                return {}
            const owner = await getAccountOwner(
                accountRuntime,
                fromNodeHeaders(req.headers)
            )
            return owner ? { accountUserId: owner } : {}
        }
    })
)

app.use(
    '/',
    express.static(path.join(__dirname, 'docs', 'out'), {
        extensions: ['html']
    })
)

startFoodRefresh()
startAcademicCalendarRefresh()
startHawEventsRefresh()

app.listen(port, () => {
    console.log(`🚀 Server ready at http://localhost:${port}/graphql`)
})
