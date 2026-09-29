import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { eventRegistry } from '../../../../lib/events';
import { InMemoryEventAdapter } from '../../../../lib/events/memory';
import { CallbackEventAdapter } from '../../../../lib/events/callback';
import { isRevoked, clearRevocations } from '../../../../services/auth/oauth-server/revocations';
import {
  OAUTH_EVENTS, revokeEverywhere, listenForRevocations,
} from '../../../../services/auth/oauth-server/revocation-events';

const GRANT = '00000000-0000-4000-8000-00000000fe01';
const claims = { gid: GRANT, sub: 'someone' };
let bus: InMemoryEventAdapter;

beforeEach(() => {
  clearRevocations();
  eventRegistry.clear();
  bus = new InMemoryEventAdapter();
  eventRegistry.register(bus);
});

afterEach(() => { eventRegistry.clear(); clearRevocations(); });

describe('revocation events', () => {
  it('revoking marks the grant here at once and publishes only its id', async () => {
    revokeEverywhere(GRANT);
    expect(isRevoked(claims)).toBe(true);
    await new Promise((r) => setImmediate(r));
    expect(bus.events).toHaveLength(1);
    expect(bus.events[0]).toMatchObject({ type: OAUTH_EVENTS.GRANT_REVOKED, source: 'oauth-server', data: { grantId: GRANT } });
    expect(Object.keys(bus.events[0].data ?? {})).toEqual(['grantId']);
  });

  it('another process marks the grant when the event reaches its callback adapter', async () => {
    const otherProcess = new CallbackEventAdapter();
    listenForRevocations(otherProcess);
    revokeEverywhere(GRANT);
    await new Promise((r) => setImmediate(r));
    clearRevocations();
    expect(isRevoked(claims)).toBe(false);
    await otherProcess.publish(bus.events[0]);
    expect(isRevoked(claims)).toBe(true);
  });

  it('ignores an event without a grant id, and stops after unsubscribing', async () => {
    const adapter = new CallbackEventAdapter();
    const unsubscribe = listenForRevocations(adapter);
    await adapter.publish({ type: OAUTH_EVENTS.GRANT_REVOKED, timestamp: '', data: {} });
    expect(isRevoked(claims)).toBe(false);
    unsubscribe();
    await adapter.publish({ type: OAUTH_EVENTS.GRANT_REVOKED, timestamp: '', data: { grantId: GRANT } });
    expect(isRevoked(claims)).toBe(false);
  });

  it('with no event adapters, revoking still works in this process', () => {
    eventRegistry.clear();
    expect(() => revokeEverywhere(GRANT)).not.toThrow();
    expect(isRevoked(claims)).toBe(true);
  });
});
