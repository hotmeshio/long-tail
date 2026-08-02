import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// ─────────────────────────────────────────────────────────────────────────────
// DDL shape for the compatibility view and the app-layer indexes. The DDL
// constants are module-private (the module's public surface is the two client
// functions), so the assertions read the source — the contract under test is
// the SQL text itself, exactly what boot sends to Postgres.
// ─────────────────────────────────────────────────────────────────────────────

const source = readFileSync(
  join(__dirname, '../../../services/escalation/client.ts'),
  'utf8',
);

describe('lt_escalations compatibility view DDL', () => {
  it('derives ended_at only for terminal rows, from the terminal-transition stamps', () => {
    expect(source).toContain(
      "(CASE WHEN status <> 'pending' THEN COALESCE(resolved_at, updated_at) END) AS ended_at",
    );
  });

  it('keeps the additive available column beside ended_at', () => {
    expect(source).toContain(
      '(assigned_to IS NULL OR assigned_until IS NULL OR assigned_until <= NOW()) AS available',
    );
  });

  it('swaps via DROP+CREATE so SELECT * re-expands against the current base columns', () => {
    expect(source).toContain('DROP VIEW IF EXISTS public.lt_escalations;');
    expect(source).toMatch(/CREATE VIEW public\.lt_escalations AS/);
    expect(source).not.toContain('CREATE OR REPLACE VIEW public.lt_escalations');
  });
});

describe('idx_hmsh_esc_ended_at DDL', () => {
  it('is a partial expression index on the terminal end instant', () => {
    expect(source).toMatch(
      /CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hmsh_esc_ended_at\s+ON public\.hmsh_escalations \(\(COALESCE\(resolved_at, updated_at\)\)\)\s+WHERE status <> 'pending'/,
    );
  });

  it('builds outside the advisory lock via the generalized ensureAppIndex path', () => {
    expect(source).toContain("ensureAppIndex('idx_hmsh_esc_ended_at', ENSURE_ENDED_AT_INDEX)");
    expect(source).toContain("ensureAppIndex('idx_hmsh_esc_resolved_cover', ENSURE_RESOLVED_COVER_INDEX)");
  });
});
