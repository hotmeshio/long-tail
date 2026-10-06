/**
 * The server's half of a browser's NATS connection, as the WebSocket proxy
 * forwards it. Message payloads (MSG and HMSG) pass through `rewrite`, which
 * returns the payload to deliver or null to withhold the message; protocol
 * lines (INFO, PING, PONG, +OK, -ERR) pass unchanged.
 *
 * Operations can span WebSocket frames, so the filter keeps whatever it has
 * not yet seen whole.
 */

const CRLF = Buffer.from('\r\n');

export class NatsServerFilter {
  private pending: Buffer = Buffer.alloc(0);

  constructor(private readonly rewrite: (payload: Buffer) => Buffer | null) {}

  /** The bytes to forward to the browser for one chunk from the server. */
  feed(chunk: Buffer): Buffer {
    this.pending = this.pending.length ? Buffer.concat([this.pending, chunk]) : chunk;
    const out: Buffer[] = [];

    for (;;) {
      const end = this.pending.indexOf(CRLF);
      if (end === -1) break;
      const line = this.pending.subarray(0, end).toString('utf8');
      const space = line.indexOf(' ');
      const op = (space === -1 ? line : line.slice(0, space)).toUpperCase();

      if (op !== 'MSG' && op !== 'HMSG') {
        out.push(this.pending.subarray(0, end + CRLF.length));
        this.pending = this.pending.subarray(end + CRLF.length);
        continue;
      }

      // MSG <subject> <sid> [reply] <size>
      // HMSG <subject> <sid> [reply] <header size> <total size>
      const args = line.slice(space + 1).trim().split(/\s+/);
      const total = Number(args[args.length - 1]);
      const headerSize = op === 'HMSG' ? Number(args[args.length - 2]) : 0;
      const start = end + CRLF.length;
      const need = start + total + CRLF.length;
      if (this.pending.length < need) break;

      const headers = this.pending.subarray(start, start + headerSize);
      const body = this.rewrite(this.pending.subarray(start + headerSize, start + total));
      this.pending = this.pending.subarray(need);
      if (body === null) continue;

      const prefix = args.slice(0, op === 'HMSG' ? -2 : -1).join(' ');
      const sizes = op === 'HMSG' ? `${headerSize} ${headerSize + body.length}` : `${body.length}`;
      out.push(Buffer.from(`${op} ${prefix} ${sizes}\r\n`, 'utf8'), headers, body, CRLF);
    }
    return Buffer.concat(out);
  }
}
