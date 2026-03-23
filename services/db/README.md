PostgreSQL connection pool and migration runner. Provides the shared `pg.Pool` singleton used by all services and a sequential SQL migration system.

Key files:
- `index.ts` — `getPool()` (lazy singleton) and `closePool()` for the shared `pg.Pool`
- `migrate.ts` — Reads `.sql` files from `schemas/`, tracks applied migrations in `lt_migrations`, applies new ones in sort order
- `schemas/` — Numbered SQL migration files (001_schema.sql, 002_seed.sql, etc.)

The `migrate.ts` file contains inline SQL for creating the `lt_migrations` tracking table and querying/inserting migration records. This is intentional — the migration runner bootstraps itself before any `sql.ts` infrastructure exists, so externalizing these queries would add complexity without benefit.
