import type { CodegenConfig } from '@graphql-codegen/cli'

const config: CodegenConfig = {
    overwrite: true,
    schema: 'src/schema/*.gql',
    generates: {
        'src/__generated__/hawconnect-schema.graphql': {
            plugins: ['schema-ast']
        }
    }
}

export default config
