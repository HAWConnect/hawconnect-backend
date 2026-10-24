# Security reporting

HAWConnect is a development project.

Report vulnerabilities privately to the club's configured maintainers. Before opening this project for public service, enable GitHub private vulnerability reporting and publish the actual club contact. Until then, use an existing private maintainer channel and do not put tokens, credentials, personal calendars or exploit details in public issues.

Keep server secrets in runtime configuration. Optional account and encrypted-sync data are stored on the backend; public-source caches are separate. Do not log private calendar URLs, auth tokens or sync contents. Account schema changes and credential rotation require deliberate operator action. See README.md and the app repository's maintainer guide for current setup and recovery limits.
