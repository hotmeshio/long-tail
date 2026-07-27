import { describe, it, expect } from 'vitest';

import * as personasApi from '../../api/personas';

// ─────────────────────────────────────────────────────────────────────────────
// Persona API validation
//
// Every 400 here returns before any database access: key alphabet, relationship
// vocabulary (canonical + write-none alias), and seed-spec shape.
// ─────────────────────────────────────────────────────────────────────────────

describe('personas api validation', () => {
  describe('createPersona', () => {
    it('rejects a missing key', async () => {
      const result = await personasApi.createPersona({ key: '' });
      expect(result.status).toBe(400);
    });

    it('rejects keys outside the role-name alphabet', async () => {
      for (const key of ['1st', 'Has Space', 'UPPER!', '-leading']) {
        const result = await personasApi.createPersona({ key });
        expect(result.status).toBe(400);
      }
    });
  });

  describe('linkPersonaRole', () => {
    it('requires key and role', async () => {
      expect((await personasApi.linkPersonaRole({ key: '', role: 'r', relationship: 'write-all' })).status).toBe(400);
      expect((await personasApi.linkPersonaRole({ key: 'p', role: '', relationship: 'write-all' })).status).toBe(400);
    });

    it('rejects an unknown relationship', async () => {
      const result = await personasApi.linkPersonaRole({ key: 'p', role: 'r', relationship: 'owner' });
      expect(result.status).toBe(400);
      expect(result.error).toContain('relationship');
    });

    it('rejects an invalid role name', async () => {
      const result = await personasApi.linkPersonaRole({ key: 'p', role: 'Bad Role', relationship: 'write-all' });
      expect(result.status).toBe(400);
    });
  });

  describe('assign/unassign', () => {
    it('requires user id and persona key', async () => {
      expect((await personasApi.assignPersona({ id: '', key: 'p' })).status).toBe(400);
      expect((await personasApi.assignPersona({ id: 'u', key: '' })).status).toBe(400);
      expect((await personasApi.unassignPersona({ id: '', key: 'p' })).status).toBe(400);
      expect((await personasApi.unassignPersona({ id: 'u', key: '' })).status).toBe(400);
    });
  });

  describe('seedPersonas', () => {
    it('requires an array of specs', async () => {
      const result = await personasApi.seedPersonas({ personas: undefined as any });
      expect(result.status).toBe(400);
    });

    it('rejects a spec with an invalid key', async () => {
      const result = await personasApi.seedPersonas({ personas: [{ key: 'Bad Key', roles: [] }] });
      expect(result.status).toBe(400);
    });

    it('rejects a spec with an unknown relationship', async () => {
      const result = await personasApi.seedPersonas({
        personas: [{ key: 'ok', roles: [{ role: 'r', relationship: 'everything' }] }],
      });
      expect(result.status).toBe(400);
      expect(result.error).toContain('relationship');
    });

    it('rejects a spec link with an invalid role', async () => {
      const result = await personasApi.seedPersonas({
        personas: [{ key: 'ok', roles: [{ role: 'Bad Role', relationship: 'write-all' }] }],
      });
      expect(result.status).toBe(400);
    });
  });
});
