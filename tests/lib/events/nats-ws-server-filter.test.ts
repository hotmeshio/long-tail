import { describe, it, expect } from 'vitest';

import { NatsServerFilter } from '../../../lib/events/nats-ws-server-filter';

// Message payloads pass through the rewrite with their sizes recomputed;
// protocol lines pass unchanged; a withheld message disappears whole.
const upper = new NatsServerFilter((p) => (p.toString() === 'drop' ? null : Buffer.from(p.toString().toUpperCase() + '!')));
const feed = (filter: NatsServerFilter, ...chunks: string[]) => chunks.map((c) => filter.feed(Buffer.from(c)).toString()).join('');

describe('NatsServerFilter', () => {
  it('passes protocol lines and rewrites a MSG payload with its new size', () => {
    const out = feed(upper, 'INFO {"server_id":"x"}\r\nPING\r\nMSG lt.events.a 1 3\r\nabc\r\n+OK\r\n');
    expect(out).toBe('INFO {"server_id":"x"}\r\nPING\r\nMSG lt.events.a 1 4\r\nABC!\r\n+OK\r\n');
  });

  it('keeps a reply subject and rewrites HMSG body and total size', () => {
    const headers = 'NATS/1.0\r\n\r\n';
    const out = feed(upper, `HMSG lt.events.b 2 _INBOX.1 ${headers.length} ${headers.length + 2}\r\n${headers}hi\r\n`);
    expect(out).toBe(`HMSG lt.events.b 2 _INBOX.1 ${headers.length} ${headers.length + 3}\r\n${headers}HI!\r\n`);
  });

  it('withholds a message the rewrite refuses, and keeps what follows', () => {
    expect(feed(upper, 'MSG s 1 4\r\ndrop\r\nPONG\r\n')).toBe('PONG\r\n');
  });

  it('reassembles a message split across frames', () => {
    const filter = new NatsServerFilter((p) => p);
    expect(feed(filter, 'MSG s 1 1', '0\r\n01234', '56789\r', '\nPING\r\n')).toBe('MSG s 1 10\r\n0123456789\r\nPING\r\n');
  });
});
