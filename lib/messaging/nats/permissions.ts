/**
 * JetStream rights scoped to named streams and one durable consumer: look up,
 * create and update those streams, create, read and acknowledge through that
 * consumer, and nothing else. Deleting or purging a stream is not granted.
 */

export interface JsScope {
  streams: string[];
  durable: string;
}

export function jsPermissions({ streams, durable }: JsScope): { publish: string[]; subscribe: string[] } {
  const perStream = streams.flatMap((s) => [
    `$JS.API.STREAM.INFO.${s}`,
    `$JS.API.STREAM.CREATE.${s}`,
    `$JS.API.STREAM.UPDATE.${s}`,
    `$JS.API.CONSUMER.INFO.${s}.${durable}`,
    `$JS.API.CONSUMER.CREATE.${s}.${durable}`,
    `$JS.API.CONSUMER.CREATE.${s}.${durable}.>`,
    `$JS.API.CONSUMER.DURABLE.CREATE.${s}.${durable}`,
    `$JS.API.CONSUMER.MSG.NEXT.${s}.${durable}`,
    `$JS.ACK.${s}.${durable}.>`,
  ]);
  return { publish: ['$JS.API.INFO', ...perStream], subscribe: ['_INBOX.>'] };
}
