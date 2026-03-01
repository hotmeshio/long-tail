#!/bin/bash
set -e

# Create the test database (used by `npm test`) alongside the app database.
# This keeps test artifacts (MCP servers, durable jobs) out of the dashboard.
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    SELECT 'CREATE DATABASE longtail_test'
    WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'longtail_test')\gexec
EOSQL
