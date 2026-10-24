#!/bin/sh
set -eu

# Run the documented account migrations explicitly before enabling accounts.
exec bun run index.ts
