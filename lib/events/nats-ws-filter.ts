/**
 * The browser's half of a NATS connection, as the WebSocket proxy forwards
 * it. A browser only subscribes, so the proxy authenticates the connection
 * itself and lets the browser read, never publish:
 *
 * - CONNECT is rewritten to carry the server's credential (the browser is
 *   never given it), keeping the client's other options.
 * - SUB, UNSUB, PING and PONG are forwarded, rebuilt from their parsed fields.
 * - Any other operation, PUB and HPUB included, marks the stream malformed
 *   and the proxy closes the connection.
 *
 * The filter reads lines as nats-server does: fields split on spaces or tabs,
 * and a line ends at LF with or without a preceding CR. Operations can span
 * WebSocket frames, so the filter keeps whatever it has not yet seen whole.
 */

const LF = 0x0a;
const MAX_LINE = 64 * 1024;
const FIELD_DELIMITER = /[ \t]+/;
/** The operation name and its argument text. */
const OPERATION = /^[ \t]*([^ \t]+)[ \t]*(.*)$/s;
/** Control characters other than tab never appear inside a client line. */
const CONTROL_CHARACTER = /[\x00-\x08\x0a-\x1f\x7f]/;

/** Client operations forwarded, with the number of fields each takes. */
const ALLOWED_OPS: Record<string, { min: number; max: number }> = {
  SUB: { min: 2, max: 3 },
  UNSUB: { min: 1, max: 2 },
  PING: { min: 0, max: 0 },
  PONG: { min: 0, max: 0 },
};

export class NatsClientFilter {
  private pending: Buffer = Buffer.alloc(0);
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
      const end = this.pending.indexOf(LF);
      if (end === -1) {
        if (this.pending.length > MAX_LINE) return this.fail();
        break;
      }
      const raw = this.pending.subarray(0, end > 0 && this.pending[end - 1] === 0x0d ? end - 1 : end);
      this.pending = this.pending.subarray(end + 1);
      const forwarded = this.filterLine(raw.toString('utf8'));
      if (this.failed) return Buffer.alloc(0);
      if (forwarded !== null) out.push(Buffer.from(`${forwarded}\r\n`, 'utf8'));
    }
    return Buffer.concat(out);
  }

  private fail(): Buffer {
    this.failed = true;
    this.pending = Buffer.alloc(0);
    return Buffer.alloc(0);
  }

  /** The line to forward, or null to forward nothing. */
  private filterLine(line: string): string | null {
    if (CONTROL_CHARACTER.test(line)) {
      this.failed = true;
      return null;
    }
    const match = OPERATION.exec(line);
    if (!match) return null;
    const op = match[1].toUpperCase();
    const rest = match[2];

    if (op === 'CONNECT') return this.rewriteConnect(rest);
    const shape = ALLOWED_OPS[op];
    const fields = rest === '' ? [] : rest.split(FIELD_DELIMITER).filter(Boolean);
    if (!shape || fields.length < shape.min || fields.length > shape.max) {
      this.failed = true;
      return null;
    }
    return [op, ...fields].join(' ');
  }

  private rewriteConnect(json: string): string | null {
    let options: Record<string, unknown>;
    try {
      options = JSON.parse(json);
    } catch {
      this.failed = true;
      return null;
    }
    if (!options || typeof options !== 'object' || Array.isArray(options)) {
      this.failed = true;
      return null;
    }
    const { auth_token: _token, user: _user, pass: _pass, jwt: _jwt, nkey: _nkey, sig: _sig, ...rest } = options;
    return `CONNECT ${JSON.stringify(this.authToken ? { ...rest, auth_token: this.authToken } : rest)}`;
  }
}
