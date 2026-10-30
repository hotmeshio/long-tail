/**
 * Put a print file on a printer. A Bambu printer on the LAN prints only files
 * on its own storage, which it serves over implicit FTPS (port 990, user
 * bblp, its access code). The upload is passive mode, its data channel on the
 * control channel's TLS session, as the printer requires. The file is then
 * named in `project_file` as `file:///sdcard/cache/<name>`.
 */

import { readFileSync } from 'fs';
import { connect, type TLSSocket } from 'tls';
import { PRINTER_ACCESS, type BambuPrinter } from './env';

/** The printer writes to its card slowly: a 2 MB file takes over a minute before it confirms. */
const TIMEOUT_MS = 300_000;

/** The URL a print request names for a file staged in the printer's cache. */
export const cachedFileUrl = (name: string) => `${PRINTER_ACCESS.CACHE_URL}/${name}`;

/** One FTP control session: send a command, read its final reply. */
class Control {
  private buffer = '';
  private waiting: ((line: string) => void)[] = [];

  constructor(readonly socket: TLSSocket) {
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      for (let at = this.buffer.indexOf('\n'); at >= 0; at = this.buffer.indexOf('\n')) {
        const line = this.buffer.slice(0, at).replace(/\r$/, '');
        this.buffer = this.buffer.slice(at + 1);
        // A final reply is a code, alone or before a space; `123-` lines continue a multi-line reply.
        if (/^\d{3}( |$)/.test(line)) this.waiting.shift()?.(line);
      }
    });
  }

  reply(): Promise<string> {
    return new Promise((resolve) => this.waiting.push(resolve));
  }

  async send(command: string, expect: RegExp): Promise<string> {
    const answer = this.reply();
    this.socket.write(`${command}\r\n`);
    const line = await answer;
    if (!expect.test(line)) throw new Error(`printer FTPS ${command.split(' ')[0]}: ${line}`);
    return line;
  }
}

function tlsTo(host: string, port: number, session?: Buffer): Promise<TLSSocket> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host, port, rejectUnauthorized: false, ...(session ? { session } : {}) }, () => resolve(socket));
    socket.setTimeout(TIMEOUT_MS, () => socket.destroy(new Error(`printer FTPS at ${host}:${port} timed out`)));
    socket.on('error', reject);
  });
}

/** Upload `localPath` to the printer's cache as `name`; returns the URL a print request names. */
export async function stageFile(printer: Pick<BambuPrinter, 'host' | 'code'>, localPath: string, name: string): Promise<string> {
  const control = new Control(await tlsTo(printer.host, PRINTER_ACCESS.FTPS_PORT));
  try {
    // 1. Log in on the TLS control channel, protect the data channel
    await control.reply();
    await control.send(`USER ${PRINTER_ACCESS.USER}`, /^331\b/);
    await control.send(`PASS ${printer.code}`, /^230\b/);
    await control.send('TYPE I', /^200\b/);
    await control.send('PBSZ 0', /^200\b/);
    await control.send('PROT P', /^200\b/);

    // 2. A passive data channel on the control channel's TLS session
    const pasv = await control.send('PASV', /^227\b/);
    const [, , , , p1, p2] = pasv.match(/\((\d+),(\d+),(\d+),(\d+),(\d+),(\d+)\)/)!.slice(1).map(Number);
    const stored = control.send(`STOR ${PRINTER_ACCESS.CACHE_DIR}/${name}`, /^1\d\d\b/);
    const data = await tlsTo(printer.host, p1 * 256 + p2, control.socket.getSession());
    await stored;

    // 3. Send the file, close the data channel, wait for the printer to confirm
    const done = control.reply();
    await new Promise<void>((resolve, reject) => data.end(readFileSync(localPath), () => resolve()).on('error', reject));
    const line = await done;
    if (!/^226\b/.test(line)) throw new Error(`printer FTPS STOR: ${line}`);
    return cachedFileUrl(name);
  } finally {
    control.socket.end('QUIT\r\n');
  }
}
