import { describe, it, expect } from 'vitest';

import { NatsClientFilter } from '../../../lib/events/nats-ws-filter';

const run = (filter: NatsClientFilter, ...chunks: string[]) =>
  chunks.map((c) => filter.feed(Buffer.from(c, 'utf8')).toString('utf8')).join('');

describe('NatsClientFilter', () => {
  it('rewrites CONNECT to carry the server token and drops any client credential', () => {
    const out = run(new NatsClientFilter('server-secret'),
      'CONNECT {"verbose":false,"auth_token":"stolen","user":"u","pass":"p","name":"nats.ws","headers":true}\r\n');
    expect(out.startsWith('CONNECT ')).toBe(true);
    const options = JSON.parse(out.slice(8).trim());
    expect(options).toEqual({ verbose: false, name: 'nats.ws', headers: true, auth_token: 'server-secret' });
  });

  it('passes SUB, UNSUB, PING and PONG through unchanged', () => {
    const ops = 'SUB lt.events.> 1\r\nUNSUB 1\r\nPING\r\nPONG\r\n';
    expect(run(new NatsClientFilter('t'), ops)).toBe(ops);
  });

  it('drops a PUB and its payload, keeping what follows', () => {
    const out = run(new NatsClientFilter('t'), 'PUB system.oauth.grant.revoked 13\r\n{"grantId":1}\r\nPING\r\n');
    expect(out).toBe('PING\r\n');
  });

  it('drops an HPUB with headers and payload', () => {
    const headers = 'NATS/1.0\r\nX: y\r\n\r\n';
    const payload = 'hi';
    const op = `HPUB agent.triggers_changed ${headers.length} ${headers.length + payload.length}\r\n${headers}${payload}\r\nSUB a 2\r\n`;
    expect(run(new NatsClientFilter('t'), op)).toBe('SUB a 2\r\n');
  });

  it('handles operations and payloads split across frames', () => {
    const filter = new NatsClientFilter('t');
    const out = run(filter, 'PU', 'B farm.capacity.short 5\r\nab', 'cde\r', '\nSU', 'B x 3\r\n');
    expect(out).toBe('SUB x 3\r\n');
  });

  it('a payload that contains a CRLF is skipped by size, not by line', () => {
    expect(run(new NatsClientFilter('t'), 'PUB a 4\r\na\r\nb\r\nPING\r\n')).toBe('PING\r\n');
  });

  it('marks a malformed stream so the proxy can close it', () => {
    const bad = new NatsClientFilter('t');
    run(bad, 'CONNECT {not json}\r\n');
    expect(bad.malformed).toBe(true);
    const badPub = new NatsClientFilter('t');
    run(badPub, 'PUB a notanumber\r\n');
    expect(badPub.malformed).toBe(true);
  });

  it('without a server token, CONNECT carries none', () => {
    const out = run(new NatsClientFilter(null), 'CONNECT {"auth_token":"x","verbose":false}\r\n');
    expect(JSON.parse(out.slice(8).trim())).toEqual({ verbose: false });
  });
});
