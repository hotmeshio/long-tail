import { describe, it, expect } from 'vitest';

import { NatsClientFilter } from '../../../lib/events/nats-ws-filter';

const run = (filter: NatsClientFilter, ...chunks: string[]) =>
  chunks.map((c) => filter.feed(Buffer.from(c, 'utf8')).toString('utf8')).join('');

/** Feed the chunks and report what was forwarded and whether the stream was closed. */
const outcome = (...chunks: string[]) => {
  const filter = new NatsClientFilter('t');
  const forwarded = run(filter, ...chunks);
  return { forwarded, malformed: filter.malformed };
};

describe('NatsClientFilter', () => {
  it('rewrites CONNECT to carry the server token and drops any client credential', () => {
    const out = run(new NatsClientFilter('server-secret'),
      'CONNECT {"verbose":false,"auth_token":"stolen","user":"u","pass":"p","name":"nats.ws","headers":true}\r\n');
    expect(out.startsWith('CONNECT ')).toBe(true);
    const options = JSON.parse(out.slice(8).trim());
    expect(options).toEqual({ verbose: false, name: 'nats.ws', headers: true, auth_token: 'server-secret' });
  });

  it('passes SUB, UNSUB, PING and PONG through', () => {
    const ops = 'SUB lt.events.> 1\r\nSUB lt.events.> q 2\r\nUNSUB 1\r\nUNSUB 2 5\r\nPING\r\nPONG\r\n';
    expect(run(new NatsClientFilter('t'), ops)).toBe(ops);
  });

  it('closes on a PUB or HPUB and forwards nothing of it', () => {
    expect(outcome('PUB system.oauth.grant.revoked 13\r\n{"grantId":1}\r\nPING\r\n'))
      .toEqual({ forwarded: '', malformed: true });
    const headers = 'NATS/1.0\r\nX: y\r\n\r\n';
    expect(outcome(`HPUB agent.triggers_changed ${headers.length} ${headers.length + 2}\r\n${headers}hi\r\n`).malformed)
      .toBe(true);
  });

  it('closes on a PUB delimited by tabs', () => {
    expect(outcome('PUB\tlt.events.probe\t2\r\nhi\r\n')).toEqual({ forwarded: '', malformed: true });
  });

  it('reads a bare LF as a line end, so a PUB after one is seen and closes', () => {
    expect(outcome('SUB a 1\nPUB lt.y 2\r\nhi\r\n')).toEqual({ forwarded: '', malformed: true });
    expect(outcome('SUB a 1\n', 'PUB lt.y 2\r\nhi\r\n')).toEqual({ forwarded: 'SUB a 1\r\n', malformed: true });
  });

  it('reads operation names in any case', () => {
    expect(run(new NatsClientFilter('t'), 'sub a 1\r\nPiNg\r\n')).toBe('SUB a 1\r\nPING\r\n');
    expect(outcome('pub a 2\r\nhi\r\n').malformed).toBe(true);
    expect(outcome('PuB a 2\r\nhi\r\n').malformed).toBe(true);
  });

  it('closes on a PUB split across frames', () => {
    expect(outcome('SUB x 3\r\nPU', 'B farm.capacity', '.short 5\r\nab', 'cde\r\n'))
      .toEqual({ forwarded: 'SUB x 3\r\n', malformed: true });
  });

  it('rebuilds a tab-delimited SUB with single spaces', () => {
    expect(run(new NatsClientFilter('t'), 'SUB\tlt.events.>\t\t7\r\n')).toBe('SUB lt.events.> 7\r\n');
  });

  it('closes on an unknown operation, a wrong field count, or a CR inside a line', () => {
    expect(outcome('INFO {}\r\n').malformed).toBe(true);
    expect(outcome('SUB onlysubject\r\n').malformed).toBe(true);
    expect(outcome('PING extra\r\n').malformed).toBe(true);
    expect(outcome('SUB a 1\rPUB x 2\r\n').malformed).toBe(true);
  });

  it('closes on a line longer than the limit with no end', () => {
    expect(outcome(`SUB ${'a'.repeat(70 * 1024)}`).malformed).toBe(true);
  });

  it('marks a malformed CONNECT so the proxy can close it', () => {
    expect(outcome('CONNECT {not json}\r\n').malformed).toBe(true);
    expect(outcome('CONNECT [1]\r\n').malformed).toBe(true);
  });

  it('forwards nothing after the stream is malformed', () => {
    const filter = new NatsClientFilter('t');
    run(filter, 'PUB a 1\r\nx\r\n');
    expect(run(filter, 'SUB a 1\r\n')).toBe('');
  });

  it('without a server token, CONNECT carries none', () => {
    const out = run(new NatsClientFilter(null), 'CONNECT {"auth_token":"x","verbose":false}\r\n');
    expect(JSON.parse(out.slice(8).trim())).toEqual({ verbose: false });
  });
});
