# HAWConnect Backend

Bun / Express / Apollo backend for the independent, student-maintained HAWConnect platform. PostgreSQL is shared by account services and dashboard-managed content. Distributed under [AGPL-3.0](LICENSE); required upstream copyright and attribution must be retained.

## Services

- Public GraphQL menus from Studierendenwerk Hamburg's official German and English pages, with current/next-week ingestion, declared labels, validation and cached snapshots.
- Public HAW events, clubs and academic-date ingestion. The academic-date scraper currently uses international-office calendars; it is not verified coverage of all departments' semester dates.
- Restricted myHAW ICS downloads for browser imports, without university credentials.
- Optional `@haw-hamburg.de` magic-link accounts and encrypted-at-rest account synchronisation. Encryption is server-managed, not end-to-end.
- Dashboard API for announcements, Campus Life events, organizer profiles, permissions, audit history and bilingual legal publications.

Direct authenticated university APIs remain future work. Removed upstream event GraphQL operations are no longer available. Legacy `clEvents`/`clClubs` do not fetch unrelated university feeds; supported clients use `campusLifeEvents`, `hawEvents` and `hawClubs`.

## Local setup

Use the version in `.bun-version` and the checked-in lockfile:

```bash
bun install --frozen-lockfile
cp .env.example .env.local
bun start
```

GraphQL runs at `http://localhost:4000/graphql`. Public ingestion does not require university accounts, SMTP or account database credentials; dashboard-managed content and account services do require the database. Public sources require outbound HTTPS.

For the normal app development server:

```dotenv
PORT=4000
HAWCONNECT_WEB_ORIGINS=http://localhost:3000,http://localhost:3001,http://localhost:8081
HAWCONNECT_AUTH_ORIGIN=http://localhost:4000
HAWCONNECT_WEB_ORIGIN=http://localhost:3000
HAWCONNECT_DASH_ORIGIN=http://localhost:43127
```

Use port 3001 for `HAWCONNECT_WEB_ORIGIN` when testing the local static preview there. Restart the backend after changing environment values; editing `.env.local` does not update an existing process or a Coolify deployment.

## Accounts, email and administration

Set these in private server configuration:

```dotenv
HAWCONNECT_ACCOUNTS_DATABASE_URL=postgres://USER:PASSWORD@HOST:PORT/DATABASE
HAWCONNECT_ACCOUNT_SECRET=REPLACE_WITH_A_RANDOM_SECRET
HAWCONNECT_SYNC_ENCRYPTION_KEY=REPLACE_WITH_BASE64_OF_32_RANDOM_BYTES
HAWCONNECT_ADMIN_EMAILS=maintainer@haw-hamburg.de

HAWCONNECT_SMTP_HOST=YOUR_SMTP_HOST
HAWCONNECT_SMTP_PORT=587
HAWCONNECT_SMTP_USER=YOUR_SMTP_USERNAME
HAWCONNECT_SMTP_PASSWORD=YOUR_SMTP_PASSWORD
HAWCONNECT_MAIL_FROM="HAWConnect <YOUR_AUTHORISED_SENDER>"
```

The database URL is canonical for both account and campus-content access. Separate `DB_HOST`, `DB_PORT`, `POSTGRES_DB`, `POSTGRES_USER` and `POSTGRES_PASSWORD` settings are fallback configuration only. Do not put secrets in public app variables or commit them.

SMTP port 587 uses STARTTLS; 465 uses implicit TLS. The sender must be authorised by the provider. An iCloud account requires an app-specific password and a configured sender/custom-domain address. Authentication verification alone does not establish sender acceptance or email delivery.

Administrator access requires explicit bootstrap email grants or delegated capabilities. Domain membership alone grants no administration rights. Admin password login is separate from student magic-link login; use the documented `admin:set-password` provisioning command with password input through stdin, never a command argument. It requires an authorised, verified account. See admin operations (local maintainer documentation).

## Database setup

Startup does not apply migrations. Back up and verify the target database before any schema change. A fresh database needs the campus-content schema and the appropriate additive identity/admin/organizer/legal migrations. Depending on what is already installed, available commands include:

```bash
bun run migrate
bun run accounts:migrate
bun run admin:migrate
bun run organizers:migrate
bun run legal:migrate
```

This is not an instruction to rerun the full sequence against an existing database. Check migration history and existing schema first. Earlier local setup applied several migrations to the configured database; that does not establish the state of a different deployment database. Keep existing sync encryption keys when moving data and back them up separately.

## Private calendar downloads and legal documents

`POST /api/calendar/myhaw` accepts a bounded JSON body containing the private export URL. Only the exact permitted HTTPS myHAW export endpoint is fetched. The route rejects redirects, does not forward university credentials and does not intentionally persist or log calendar contents. Limits include 15 seconds, 2 MB, ten requests per IP/minute and eight concurrent downloads per process. Reverse-proxy/APM configuration must also keep request bodies and private links out of logs.

`GET /api/legal` exposes published legal documents only. Admin legal endpoints keep drafts and publication snapshots separate, require the admin capability, and audit saves/publications/withdrawals. Legal content is not generated or published automatically.

## Deployment with Coolify

Create a Dockerfile application using repository root, `/Dockerfile`, internal port **4000**, and the target domain `https://api.hawconnect.de`. The target is not a claim of a live deployment.

```dotenv
NODE_ENV=production
HAWCONNECT_AUTH_ORIGIN=https://api.hawconnect.de
HAWCONNECT_WEB_ORIGIN=https://hawconnect.de
HAWCONNECT_WEB_ORIGINS=https://hawconnect.de
HAWCONNECT_DASH_ORIGIN=https://dash.hawconnect.de
```

Supply private configuration at runtime. Use a reachable PostgreSQL service and configured SMTP provider. Local environment files are not transferred to Coolify automatically.

The Dockerfile runs as an unprivileged user and directs food, academic-calendar and event snapshots to `/var/lib/hawconnect`; mount persistent storage there. Clubs write to `/usr/src/app/.cache`; mount persistent storage there as well. The Dockerfile prepares both directories with application-user ownership and includes curl for Coolify health checks. Storage persistence is not a substitute for backups.

Food refresh defaults to thirty minutes with a five-minute minimum; academic dates refresh daily and official events hourly. Valid cached snapshots are retained after source failures. Container builds, production deployment and actual email delivery have not been verified.

## Checks and structure

```bash
bun run codegen
bunx tsc --noEmit
bun run lint
bun test
```

`codegen` generates `src/__generated__/hawconnect-schema.graphql` from local SDL; `codegen:hawconnect` is an alias. Regenerate the sibling app client after changing the schema. The app expects this repository at `../hawconnect-backend`.

| Path | Responsibility |
| --- | --- |
| `index.ts` | HTTP setup and ingestion startup |
| `src/schema`, `src/resolvers.ts`, `src/queries` | GraphQL contract |
| `src/scraping` | Parsers, source fixtures and tests |
| `src/utils` | Refresh, validation and cache services |
| `src/lib` | Accounts, mail, calendar and legal HTTP services |
| `src/admin` | Privileged API, policies and audit-backed operations |
| `src/db/accounts` | Explicit additive migrations |

Recent normal checks: 53 tests passed and 26 external-database tests skipped. Skipped tests are not evidence of passing integrations. Use dedicated isolated test databases for integration suites; never production data.

## Ownership and licence

Git metadata was removed at the maintainer’s request; initialise a fresh repository before configuring the intended origin `https://github.com/HAWConnect/hawconnect-backend.git`; remote repository availability must be confirmed before pushing. Retain [LICENSE](LICENSE), required copyright/source attribution and migration history. Publishing workflows remain archived until club infrastructure is configured. See [AGENTS.md](AGENTS.md) and the sibling app's local `.private/developer-docs/` archives for handover, architecture and verification limits.

## Fresh-install migration baseline

The published app-schema migration chain now begins at `src/db/migrations/0000_hawconnect_baseline.sql`. It is generated from the current schema and uses only project-owned event-table, constraint, index and sequence names. It creates five app tables; account, sync, administrator and legal-document migrations remain separate.

**This baseline is not an upgrade path for existing databases.** The previous fourteen-migration chain and upgrade tests were preserved only in the ignored local developer archive. Their names and hashes must not be silently substituted in an existing database’s journal. The configured project database has not been changed or adopted.

For a genuinely empty database, first review the target and run `bun run migrate` to apply the app baseline. Apply the separately documented account/admin/content migrations afterwards as required. The migration runner takes a database advisory lock and validates recognised history on the same connection before applying schema SQL. Unknown/modified history or existing public tables, views, sequences or enum/domain types without a recognised baseline cause `ExistingDatabaseRequiresMigrationAdoption` with no migration applied.

If that error occurs, stop and preserve a backup plus the existing journal/schema. A maintainer must review a separate adoption/upgrade procedure; do not drop tables, delete the journal, rerun old migrations or add baseline hashes manually. Recognised baseline reruns preserve existing rows and are supported.

Isolated migration tests require `HAWCONNECT_MIGRATION_TEST_URL` pointing to a disposable loopback PostgreSQL database named `hawconnect_migration_test`. Run `bun test src/utils/tests/migration-baseline.test.ts src/utils/tests/migration-baseline-integration.test.ts`. The integration suite resets only its explicitly selected test schemas; never target valuable data.
