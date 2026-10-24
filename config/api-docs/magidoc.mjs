import path from 'node:path'
import { fileURLToPath } from 'node:url'
const relativePath = (target) => path.join(path.dirname(fileURLToPath(import.meta.url)),target)
export default {
    introspection: { type: 'sdl', paths: ['src/schema/*.gql'] },
    website: {
        template: './config/api-docs/template',
        staticAssets: relativePath('./assets'),
        output: relativePath('../../docs/out'),
        options: {
            appTitle: 'HAWConnect API',
            siteMeta: { description: 'Student-maintained HAWConnect backend documentation', keywords: 'hawconnect,haw hamburg,graphql' },
            pages: [{ title: 'HAWConnect API', content: `# HAWConnect API

Student-maintained campus services for HAW Hamburg. Source attribution is retained in NOTICE.md. No official university endorsement is claimed.

## Local endpoint

GraphQL: http://localhost:4000/graphql

No production endpoint has been established by this repository. Configure club-owned URLs at deployment.

## Available services

Public food menus use official German and English Studierendenwerk sources. The academic calendar uses official HAW international-office dates. Optional HAWConnect accounts support email magic links and encrypted sync; their SMTP delivery and cross-device behaviour still need end-to-end verification. These accounts are separate from myHAW.

Some upstream schema fields remain for compatibility. Their presence does not establish a working HAW integration or an admin panel. Consult the repository README and feature-status documentation.

## Configuration and attribution

Use the server environment templates. Never publish SMTP passwords, private calendar URLs, database passwords or encryption keys. Academic and menu caches must have persistent writable storage. Account migrations are explicit operator actions. Source code is AGPL-3.0; retain original notices and third-party attribution.
` }],
            queryGenerationFactories: { LocalTime: '<23:30:50>', EmailAddress: '<test@example.com>', URL: '<https://example.com>', LocationInput: '["BerlinerTorMensa"]' }
        }
    }
}
