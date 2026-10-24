# HAWConnect backend contributor guide

Independent student-maintained HAW Hamburg service. Preserve attribution in `NOTICE.md` and `LICENSE`. Current HAWConnect instructions take precedence; local historical archives are not publication inputs.

## Structure

Use Bun / TypeScript, Express / Apollo, existing GraphQL SDL and resolvers, Cheerio scraping, PostgreSQL account storage, and existing cache/persistence boundaries. The Expo app remains at `../hawconnect`; no monorepo or new service framework is required.

- `index.ts`: server and refresh startup.
- `src/schema`, `src/resolvers.ts`, `src/queries`: API contract.
- `src/scraping`: source parsers and fixtures; parser tests live in `src/scraping/tests`.
- `src/utils/food-refresh.ts`, `academic-calendar.ts`: validated public-source caching.
- `src/lib`, `src/db/accounts`: accounts, SMTP, encryption and explicit account migrations.
- Other connected upstream GraphQL helpers remain for compatibility; do not claim them as HAW integrations.

## Rules

Preserve unrelated work. Never read private environment values into logs or commit secrets. Public scrapers must work without accounts or university credentials. Use official DE/EN content; never guess translations, allergens or nutrition. Validate before replacing cached data, use timeouts/bounded retries and retain last valid snapshots after failure. Keep calendar links and event contents out of diagnostics. Log safe service-level failures only.

Use `bun run codegen` for local schema artifacts, never the retired remote Reimanns generator. Do not edit generated types by hand. Use the original Biome conventions (four spaces, single quotes, no semicolons/trailing commas). Avoid dependency upgrades unrelated to the task.

Do not run migrations, send email, publish containers or change deployment infrastructure without authorisation for that action. Startup does not run migrations automatically. Account migrations are `bun run accounts:migrate`; confirm target ownership before use. Leave archived publishing workflows inactive until explicitly configured for club infrastructure.

## Checks

```bash
bun run codegen
bunx tsc --noEmit
bun run lint
bun test
```

Regenerate the sibling app's client if SDL changes. Distinguish skipped external integration tests from passing checks. Current cross-project status/setup/operations are documented in local `.private/developer-docs/` archives.
