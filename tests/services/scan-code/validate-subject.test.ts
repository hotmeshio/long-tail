import { describe, it, expect } from 'vitest';

import { assertValidSteps } from '../../../services/scan-code';
import type { ScanStep } from '../../../types';

const binIt = (over: Partial<ScanStep> = {}): ScanStep => ({
  query: { roles: ['bin-packer'] },
  verb: 'accumulate',
  subject: { schemes: [11] },
  match: { target: ['{subject.binCode}'] },
  refuse: { markdown: "That's {container.facilityName}'s tub. This bag goes in **{subject.binCode}**." },
  params: {
    itemKey: '{subject.orderId}',
    accumulate: { from: 'subject', container: { types: ['bin'], subtypes: ['open', 'free'] } },
  },
  ...over,
} as ScanStep);

const check = (step: ScanStep) => () => assertValidSteps([step]);

describe('subject steps', () => {
  it('accepts the bag-then-tub step', () => {
    expect(check(binIt())).not.toThrow();
  });

  it('acting on the subject needs a subject gate, and a gate needs a subject act', () => {
    expect(check(binIt({ subject: undefined, match: undefined, refuse: undefined, params: { itemKey: 'x', accumulate: { from: 'subject' } } })))
      .toThrow(/requires a subject gate/);
    expect(check(binIt({ params: { itemKey: 'x' } }))).toThrow(/must act on it/);
  });

  it('subject.facets must be a non-empty map of facet keys to scalars', () => {
    expect(check(binIt({ subject: { schemes: [11], facets: { binState: 'unbound' } } }))).not.toThrow();
    expect(check(binIt({ subject: { schemes: [11], facets: {} } }))).toThrow(/non-empty object/);
    expect(check(binIt({ subject: { schemes: [11], facets: { 'bad key': 'x' } } }))).toThrow(/facet key/);
    expect(check(binIt({ subject: { schemes: [11], facets: { binState: ['x'] as any } } }))).toThrow(/string, number, or boolean/);
  });

  it('a subject gate applies only to accumulate and fill', () => {
    expect(check(binIt({ verb: 'resolve', params: { resolverPayload: {} } }))).toThrow(/only to accumulate and fill/);
  });

  it('from-subject needs an item key; from and into are exclusive; no item-mode facet', () => {
    expect(check(binIt({ params: { accumulate: { from: 'subject' } } }))).toThrow(/requires params.itemKey/);
    expect(check(binIt({ params: { itemKey: 'x', accumulate: { from: 'subject', into: 'subject' } } }))).toThrow(/exclusive/);
    expect(check(binIt({ params: { itemKey: 'x', accumulate: { from: 'subject', containerFacet: 'binKey' } } }))).toThrow(/item mode/);
  });

  it('match.facets compares a located container, so it needs from-subject', () => {
    expect(check(binIt({ match: { facets: ['boxKey'] }, refuse: undefined, params: { accumulate: { into: 'subject' } } })))
      .toThrow(/from-subject accumulate/);
  });

  it('refuse.missing is markdown, and only for a from-subject accumulate', () => {
    expect(check(binIt({ refuse: { markdown: 'x', missing: 'Bin just taken.' } }))).not.toThrow();
    expect(check(binIt({
      refuse: { markdown: 'x', missing: 'y' }, match: { target: ['{subject.binCode}'] },
      params: { accumulate: { into: 'subject' } },
    }))).toThrow(/only to a from-subject accumulate, or an into-subject accumulate with item/);
  });

  it('refusal copy needs markdown; a subject step cannot confirm', () => {
    expect(check(binIt({ refuse: { markdown: '' } }))).toThrow(/refuse.markdown/);
    expect(check(binIt({ confirm: { prompt: 'sure?' } }))).toThrow(/cannot carry confirm/);
  });

  it('{container.x} reads only in refusal copy, {subject.x} only behind a gate', () => {
    expect(check(binIt({ params: { itemKey: '{container.binCode}', accumulate: { from: 'subject' } } })))
      .toThrow(/only in the refusal or done copy/);
    expect(() => assertValidSteps([{ query: {}, verb: 'resolve', params: { resolverPayload: { o: '{subject.orderId}' } } }]))
      .toThrow(/subject gate/);
  });
});

describe('into-subject with item', () => {
  const packBag = (over: Partial<ScanStep> = {}): ScanStep => ({
    query: { roles: ['bin-packer'], status: 'pending' }, verb: 'accumulate', subject: { schemes: [14] },
    match: { target: ['{subject.memberCodes}'] },
    refuse: { markdown: 'Not this bin.', missing: 'Not waiting.', conflict: 'Box closed.' },
    done: { markdown: '{item.itemCode} in. {container.accumulate_count} of {container.accumulate_max}.' },
    params: {
      itemKey: '{scan.target}', resolverPayload: { stickerCode: '{scan.target}' },
      accumulate: { into: 'subject', item: { roles: ['ship'], facets: { shape: 'consolidated' } } },
    },
    ...over,
  } as ScanStep);

  it('accepts the packing step with item, refuse.missing, and item/container copy', () => {
    expect(check(packBag())).not.toThrow();
  });

  it('item applies only to into-subject', () => {
    expect(check(binIt({ params: { itemKey: 'x', accumulate: { from: 'subject', item: {} } } }))).toThrow(/only to an into-subject/);
  });

  it('item.roles, types and subtypes are non-empty string arrays; facets keys are facet keys', () => {
    const withItem = (item: any) => packBag({ params: { accumulate: { into: 'subject', item } } });
    expect(check(withItem({ roles: [] }))).toThrow(/item.roles/);
    expect(check(withItem({ roles: 'ship' }))).toThrow(/item.roles/);
    expect(check(withItem({ types: [''] }))).toThrow(/item.types/);
    expect(check(withItem({ subtypes: 3 }))).toThrow(/item.subtypes/);
    expect(check(withItem({ facets: { 'bad key': 1 } }))).toThrow(/facet key/);
    expect(check(withItem([]))).toThrow(/must be an object/);
  });

  it('{item.x} needs the item selector', () => {
    expect(check(packBag({ params: { itemKey: '{item.orderId}', accumulate: { into: 'subject' } }, refuse: undefined, done: undefined })))
      .toThrow(/reads the located item row/);
  });

  it('{container.x} stays out of params', () => {
    expect(check(packBag({ params: { itemKey: '{container.binCode}', accumulate: { into: 'subject', item: {} } } })))
      .toThrow(/only in the refusal or done copy/);
  });
});

describe('done copy', () => {
  it('a writing step may carry done copy that reads the container', () => {
    expect(check(binIt({ done: { markdown: 'Drop it in **{container.binCode}**.' } }))).not.toThrow();
  });

  it('done needs markdown, belongs only to steps that write, and reads only the bags the step has', () => {
    expect(check(binIt({ done: { markdown: '' } }))).toThrow(/done.markdown/);
    expect(check({ query: {}, verb: 'show-detail', done: { markdown: 'x' } })).toThrow(/only to steps that write/);
    expect(check({ query: {}, verb: 'resolve', params: { resolverPayload: {} }, done: { markdown: '{container.binCode}' } }))
      .toThrow(/refusal or done copy/);
  });
});

describe('hold and fill', () => {
  it('a hold may read its row and declare the next scan', () => {
    expect(check({
      query: { roles: ['binning-associate'] },
      verb: 'hold',
      params: { hold: { ttlSeconds: 45, label: '{scan.target}', expect: { schemes: [14], prompt: 'Scan **{item.binCode}**' } } },
    })).not.toThrow();
  });

  it('a hold rejects a bad ttl, scheme list, or confirm', () => {
    expect(check({ query: {}, verb: 'hold', params: { hold: { ttlSeconds: 1 } } })).toThrow(/ttlSeconds/);
    expect(check({ query: {}, verb: 'hold', params: { hold: { expect: { schemes: [] } } } })).toThrow(/expect.schemes/);
    expect(check({ query: {}, verb: 'hold', confirm: { prompt: 'x' } })).toThrow(/mutating verbs/);
  });

  it('a fill into the subject needs a gate; {fill.x} reads only in its refusal', () => {
    const fill: ScanStep = {
      query: {}, verb: 'fill', subject: { schemes: [11] },
      refuse: { markdown: 'Expecting {fill.pending}.' },
      params: { fill: { into: 'subject' } },
    };
    expect(check(fill)).not.toThrow();
    expect(check({ ...fill, subject: undefined })).toThrow(/requires a subject gate/);
    expect(check({ ...fill, params: { fill: { into: 'subject', payload: { p: '{fill.pending}' } } } })).toThrow(/refusal or done copy of a fill/);
    expect(check({ ...fill, subject: undefined, refuse: undefined, params: { fill: { into: 'bin' as any } } })).toThrow(/into must be/);
  });

  it('fill is not a choice verb; hold is', () => {
    const present = (verb: string): ScanStep => ({ query: {}, verb: 'present', choices: [{ label: 'Go', verb: verb as any }] });
    expect(check(present('fill'))).toThrow(/cannot be a choice verb/);
    expect(check(present('hold'))).not.toThrow();
  });
});
