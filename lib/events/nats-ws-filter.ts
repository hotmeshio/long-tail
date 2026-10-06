/**
 * The browser's half of a NATS connection, as the WebSocket proxy forwards
 * it. A browser only subscribes, so the proxy authenticates the connection
 * itself and lets the browser read, never publish:
 *
 * - CONNECT is rewritten to carry the server's credential (the browser is
 *   never given it), keeping the client's other options.
 * - PUB and HPUB are dropped with their payloads.
 * - SUB, UNSUB, PING and PONG pass through unchanged.
 *
 * The NATS client protocol is line-oriented (`OP args\r\n`), and a publish is
 * followed by a payload of a declared size. Operations can span WebSocket
 * frames, so the filter keeps whatever it has not yet seen whole.
 */

const CRLF = Buffer.from('\r\n');
const MAX_LINE = 64 * 1024;

export class NatsClientFilter {
  private pending: Buffer = Buffer.alloc(0);
  /** Payload bytes (plus the trailing CRLF) of a dropped publish still to skip. */
  private skip = 0;
  private failed = false;

  constructor(private readonly authToken: string | null) {}

  /** Whether the stream was malformed; the proxy closes the connection. */
  get malformed(): boolean {
    return this.failed;
  }

  /** The bytes to forward upstream for one chunk from the browser. */
  feed(chunk: Buffer): Buffer {
    if (this.failed) return Buffer.alloc(0);
    this.pending = this.pending.length ? Buffer.concat([this.pending, chunk]) : chunk;
    const out: Buffer[] = [];

    for (;;) {
      if (this.skip > 0) {
        const n = Math.min(this.skip, this.pending.length);
        this.pending = this.pending.subarray(n);
        this.skip -= n;
        if (this.skip > 0) break;
      }
      const end = this.pending.indexOf(CRLF);
      if (end === -1) {
        if (this.pending.length > MAX_LINE) this.failed = true;
        break;
      }
      const line = this.pending.subarray(0, end).toString('utf8');
      this.pending = this.pending.subarray(end + CRLF.length);
      const forwarded = this.filterLine(line);
      if (this.failed) return Buffer.alloc(0);
      if (forwarded !== null) out.push(Buffer.from(`${forwarded}\r\n`, 'utf8'));
    }
    return Buffer.concat(out);
  }

  /** The line to forward, or null to drop it. */
  private filterLine(line: string): string | null {
    const space = line.indexOf(' ');
    const op = (space === -1 ? line : line.slice(0, space)).toUpperCase();
    const args = space === -1 ? '' : line.slice(space + 1);

    if (op === 'CONNECT') return this.rewriteConnect(args);
    if (op === 'PUB' || op === 'HPUB') {
      // PUB <subject> [reply] <size>; HPUB <subject> [reply] <header size> <total size>
      const size = Number(args.trim().split(/\s+/).pop());
      if (!Number.isInteger(size) || size < 0) {
        this.failed = true;
        return null;
      }
      this.skip = size + CRLF.length;
      return null;
    }
    return line;
  }

  private rewriteConnect(json: string): string | null {
    let options: Record<string, unknown>;
    try {
      options = JSON.parse(json);
    } catch {
      this.failed = true;
      return null;
    }
    const { auth_token: _token, user: _user, pass: _pass, jwt: _jwt, nkey: _nkey, sig: _sig, ...rest } = options;
    return `CONNECT ${JSON.stringify(this.authToken ? { ...rest, auth_token: this.authToken } : rest)}`;
  }
}
