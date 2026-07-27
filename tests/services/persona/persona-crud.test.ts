import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client as Postgres } from 'pg';
import { Durable } from '@hotmeshio/hotmesh';

import { postgres_options } from '../../setup';
import { connectTelemetry, disconnectTelemetry } from '../../setup/telemetry';
import { migrate } from '../../../lib/db/migrate';
import * as personaService from '../../../services/persona';

const { Connection } = Durable;

// ─────────────────────────────────────────────────────────────────────────────
// Persona CRUD + role links + declarative seed
//
// Personas are named role bundles. This suite covers the record lifecycle and
// the declarative seed pass (upsert + link sync); assignment semantics live in
// persona-assignment.test.ts.
// ─────────────────────────────────────────────────────────────────────────────

const KEYS = ['pc-alpha', 'pc-beta', 'pc-seeded', 'pc-seeded-2'];

async function cleanup() {
  for (const key of KEYS) {
    await personaService.deletePersona(key);
  }
}

describe('persona service — crud, links, seed', () => {
  beforeAll(async () => {
    await connectTelemetry();
    await Connection.connect({ class: Postgres, options: postgres_options });
    await migrate();
    await cleanup();
  }, 30_000);

  afterAll(async () => {
    await cleanup();
    await Durable.shutdown();
    await disconnectTelemetry();
  }, 10_000);

  describe('CRUD', () => {
    it('creates a persona with empty links', async () => {
      const persona = await personaService.createPersona({
        key: 'pc-alpha',
        title: 'Alpha',
        description: 'First bundle',
      });
      expect(persona.key).toBe('pc-alpha');
      expect(persona.title).toBe('Alpha');
      expect(persona.roles).toEqual([]);
      expect(persona.user_count).toBe(0);
    });

    it('rejects a duplicate key', async () => {
      await expect(personaService.createPersona({ key: 'pc-alpha' })).rejects.toThrow();
    });

    it('lists personas with role links and counts', async () => {
      const personas = await personaService.listPersonas();
      const alpha = personas.find((p) => p.key === 'pc-alpha');
      expect(alpha).toBeTruthy();
      expect(alpha!.roles).toEqual([]);
      expect(alpha!.user_count).toBe(0);
    });

    it('gets a persona with assignees', async () => {
      const persona = await personaService.getPersona('pc-alpha');
      expect(persona!.key).toBe('pc-alpha');
      expect(persona!.assignees).toEqual([]);
    });

    it('returns null for an unknown key', async () => {
      expect(await personaService.getPersona('pc-missing')).toBeNull();
    });

    it('patches title/description independently', async () => {
      const patched = await personaService.updatePersona('pc-alpha', { title: 'Alpha 2' });
      expect(patched!.title).toBe('Alpha 2');
      expect(patched!.description).toBe('First bundle');

      const cleared = await personaService.updatePersona('pc-alpha', { description: null });
      expect(cleared!.title).toBe('Alpha 2');
      expect(cleared!.description).toBeNull();
    });

    it('returns null when updating an unknown persona', async () => {
      expect(await personaService.updatePersona('pc-missing', { title: 'x' })).toBeNull();
    });
  });

  describe('role links', () => {
    it('links a role, creating the role FK target if absent', async () => {
      const result = await personaService.linkPersonaRole('pc-alpha', 'pc-role-one', 'write-all');
      expect(result!.role).toBe('pc-role-one');
      expect(result!.relationship).toBe('write-all');
    });

    it('updates an existing link relationship on re-link', async () => {
      const result = await personaService.linkPersonaRole('pc-alpha', 'pc-role-one', 'read-all');
      expect(result!.relationship).toBe('read-all');
      const persona = await personaService.getPersona('pc-alpha');
      expect(persona!.roles).toEqual([{ role: 'pc-role-one', relationship: 'read-all' }]);
    });

    it('returns null when linking on an unknown persona', async () => {
      expect(await personaService.linkPersonaRole('pc-missing', 'r', 'write-all')).toBeNull();
    });

    it('unlinks a role', async () => {
      const result = await personaService.unlinkPersonaRole('pc-alpha', 'pc-role-one');
      expect(result.unlinked).toBe(true);
      const persona = await personaService.getPersona('pc-alpha');
      expect(persona!.roles).toEqual([]);
    });

    it('reports a missing link distinctly from a missing persona', async () => {
      expect(await personaService.unlinkPersonaRole('pc-alpha', 'pc-role-one')).toEqual({
        unlinked: false,
        personaFound: true,
      });
      expect((await personaService.unlinkPersonaRole('pc-missing', 'r')).personaFound).toBe(false);
    });
  });

  describe('declarative seed', () => {
    it('upserts personas and syncs links idempotently', async () => {
      const specs = [
        {
          key: 'pc-seeded',
          title: 'Seeded',
          description: 'From config',
          roles: [
            { role: 'pc-role-one', relationship: 'write-all' as const },
            { role: 'pc-role-two', relationship: 'read-all' as const },
          ],
        },
        { key: 'pc-seeded-2', title: 'Placeholder', roles: [] },
      ];
      const first = await personaService.seedPersonas(specs);
      expect(first.personas).toBe(2);
      expect(first.links).toBe(2);

      // Re-running is a no-op overlay.
      const second = await personaService.seedPersonas(specs);
      expect(second.personas).toBe(2);

      const seeded = await personaService.getPersona('pc-seeded');
      expect(seeded!.roles).toHaveLength(2);
    });

    it('prunes links absent from the spec and overlays relationship changes', async () => {
      await personaService.seedPersonas([
        {
          key: 'pc-seeded',
          title: 'Seeded',
          roles: [{ role: 'pc-role-one', relationship: 'write-self' as const }],
        },
      ]);
      const seeded = await personaService.getPersona('pc-seeded');
      expect(seeded!.roles).toEqual([{ role: 'pc-role-one', relationship: 'write-self' }]);
    });

    it('overlays title/description authoritatively', async () => {
      await personaService.seedPersonas([{ key: 'pc-seeded-2', title: 'Renamed', roles: [] }]);
      const persona = await personaService.getPersona('pc-seeded-2');
      expect(persona!.title).toBe('Renamed');
      expect(persona!.description).toBeNull();
    });
  });

  describe('delete', () => {
    it('deletes a persona and reports the outcome', async () => {
      const created = await personaService.createPersona({ key: 'pc-beta' });
      expect(created.key).toBe('pc-beta');
      const result = await personaService.deletePersona('pc-beta');
      expect(result.deleted).toBe(true);
      expect(await personaService.getPersona('pc-beta')).toBeNull();
    });

    it('returns deleted:false for an unknown persona', async () => {
      expect((await personaService.deletePersona('pc-missing')).deleted).toBe(false);
    });
  });
});
