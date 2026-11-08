/**
 * The simulated printer's storage, as a printer serves it: implicit FTPS on
 * port 990, user bblp with the access code, passive mode with the data channel
 * over TLS. It answers the commands `files.ts` sends and keeps what each STOR
 * delivered (its name, size and sha256), not the bytes.
 */

import { createHash } from 'crypto';
import { createServer, type Server, type TLSSocket } from 'tls';
import type { AddressInfo } from 'net';

import { PRINTER_ACCESS } from '../env';

export interface StoredFile {
  name: string;
  bytes: number;
  sha256: string;
  at: string;
}

export interface FtpsOptions {
  key: Buffer;
  cert: Buffer;
  code: string;
  port?: number;
}

/** One control session: log in, then any number of PASV and STOR pairs. */
class Session {
  private user = '';
  private loggedIn = false;
  private data?: Promise<TLSSocket>;
  private buffer = '';

  constructor(private readonly socket: TLSSocket, private readonly opts: FtpsOptions, private readonly stored: Map<string, StoredFile>) {
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => this.read(chunk));
    socket.on('error', () => socket.destroy());
    this.say(220, 'Simulated printer FTPS ready');
  }

  private say(code: number, text: string): void {
    this.socket.write(`${code} ${text}\r\n`);
  }

  private read(chunk: string): void {
    this.buffer += chunk;
    for (let at = this.buffer.indexOf('\n'); at >= 0; at = this.buffer.indexOf('\n')) {
      const line = this.buffer.slice(0, at).replace(/\r$/, '');
      this.buffer = this.buffer.slice(at + 1);
      this.command(line).catch((err) => this.say(451, err.message));
    }
  }

  private async command(line: string): Promise<void> {
    const [verb, ...rest] = line.split(' ');
    const arg = rest.join(' ');
    switch (verb.toUpperCase()) {
      case 'USER':
        this.user = arg;
        return this.say(331, 'Password required');
      case 'PASS':
        this.loggedIn = this.user === PRINTER_ACCESS.USER && arg === this.opts.code;
        return this.loggedIn ? this.say(230, 'Logged in') : this.say(530, 'Login incorrect');
      case 'QUIT':
        this.say(221, 'Bye');
        return void this.socket.end();
    }
    if (!this.loggedIn) return this.say(530, 'Not logged in');
    switch (verb.toUpperCase()) {
      case 'TYPE':
      case 'PBSZ':
      case 'PROT':
        return this.say(200, `${verb} ok`);
      case 'PWD':
        return this.say(257, '"/"');
      case 'PASV':
        return this.say(227, `Entering Passive Mode (${await this.passive()})`);
      case 'STOR':
        return this.store(arg);
      default:
        return this.say(502, `${verb} not implemented`);
    }
  }

  /** A data listener for one transfer, as `h1,h2,h3,h4,p1,p2`. */
  private passive(): Promise<string> {
    const server = createServer({ key: this.opts.key, cert: this.opts.cert });
    this.data = new Promise((resolve) => server.once('secureConnection', (socket) => {
      server.close();
      resolve(socket);
    }));
    return new Promise((resolve) => server.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      const host = (this.socket.localAddress ?? '127.0.0.1').replace(/^::ffff:/, '').split('.');
      resolve([...(host.length === 4 ? host : ['127', '0', '0', '1']), Math.floor(port / 256), port % 256].join(','));
    }));
  }

  private async store(path: string): Promise<void> {
    if (!this.data) return this.say(425, 'Use PASV first');
    const socket = await this.data;
    this.data = undefined;
    this.say(150, `Opening data connection for ${path}`);
    const hash = createHash('sha256');
    let bytes = 0;
    socket.on('data', (chunk: Buffer) => {
      hash.update(chunk);
      bytes += chunk.length;
    });
    socket.on('end', () => {
      const name = path.split('/').pop()!;
      this.stored.set(name, { name, bytes, sha256: hash.digest('hex'), at: new Date().toISOString() });
      this.say(226, 'Transfer complete');
    });
  }
}

/** Serve the printer's storage; `stored` fills as files arrive. */
export function startFtps(opts: FtpsOptions, stored: Map<string, StoredFile>): Promise<Server> {
  const server = createServer({ key: opts.key, cert: opts.cert }, (socket) => new Session(socket, opts, stored));
  return new Promise((resolve) => server.listen(opts.port ?? PRINTER_ACCESS.FTPS_PORT, () => resolve(server)));
}
