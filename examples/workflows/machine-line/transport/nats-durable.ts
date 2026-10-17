/**
 * Read a durable JetStream consumer one message at a time and settle each
 * with the handler's disposition: ack, nak with a delay, or term.
 */

import type { ConsumerMessages, JetStreamClient, JsMsg } from 'nats';

import type { SerialQueue } from './serial';
import { DISPOSITION, type Disposition } from './types';

export async function readDurable(
  js: JetStreamClient,
  stream: string,
  durable: string,
  queue: SerialQueue,
  handle: (msg: JsMsg) => Promise<Disposition>,
  nakDelayMs: number,
): Promise<ConsumerMessages> {
  const consumer = await js.consumers.get(stream, durable);
  const messages = await consumer.consume();
  void (async () => {
    for await (const m of messages) {
      const disposition = await queue.run(() => handle(m)).catch(() => DISPOSITION.NAK);
      if (disposition === DISPOSITION.ACK) m.ack();
      else if (disposition === DISPOSITION.NAK) m.nak(nakDelayMs);
      else m.term();
    }
  })();
  return messages;
}

export function payloadOf(m: { data: Uint8Array }): string {
  return Buffer.from(m.data).toString('utf8');
}
