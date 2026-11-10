import { describe, it, expect, vi } from 'vitest';

import { answerRefusal, type AnswerLine } from '../../../services/machines/answer-check';
import { commandOpsOf } from '../../../services/machines/surface';
import { DEFAULT_LINE } from '../../../examples/workflows/machine-line/line';
import { ACK_OP, requestCodec } from '../../helpers/machine-request-codec';

const row = (over: Record<string, any> = {}) => ({
  id: 'req-1',
  metadata: { siteId: DEFAULT_LINE.siteId, lineId: DEFAULT_LINE.lineId, machineId: 'press-01', op: ACK_OP, ref: 'm-81f3', ...over },
});
const lineWith = (codec = requestCodec()): AnswerLine => ({ line: DEFAULT_LINE, codec, ops: commandOpsOf(codec) });
const runs = (run: AnswerLine | undefined) => () => run;

describe('answerRefusal', () => {
  it('accepts an answer the codec sends, encoding it once as a dry run naming the request', () => {
    const codec = requestCodec();
    const encode = vi.spyOn(codec, 'encode');
    expect(answerRefusal(row(), 'answer', { args: { accepted: true } }, runs(lineWith(codec)))).toBeNull();
    expect(encode).toHaveBeenCalledWith(expect.objectContaining({ machineId: 'press-01' }), {
      cmdId: 'req-1:answer', op: ACK_OP, args: { accepted: true }, respondingTo: 'm-81f3',
    });
  });

  it('refuses an op outside the line\'s commands', () => {
    expect(answerRefusal(row(), 'answer', { args: {}, op: 'launch' }, runs(lineWith()))).toMatch(/launch is not a command an answer may be sent as/);
  });

  it('refuses an answer the codec has no message for', () => {
    expect(answerRefusal(row(), 'answer', { args: {} }, runs(lineWith(requestCodec({ encodes: false }))))).toMatch(/has no material-ack command/);
  });

  it('refuses with the codec\'s own message when encode throws', () => {
    const codec = requestCodec();
    codec.encode = () => { throw new Error('quantity must be a whole number'); };
    expect(answerRefusal(row(), 'answer', { args: { quantity: 1.5 } }, runs(lineWith(codec)))).toMatch(/quantity must be a whole number/);
  });

  it('refuses args that are not an object, and a machine not on the line', () => {
    expect(answerRefusal(row(), 'answer', { args: [1] }, runs(lineWith()))).toMatch(/args must be an object/);
    expect(answerRefusal(row({ machineId: 'ghost' }), 'answer', { args: {} }, runs(lineWith()))).toMatch(/ghost is not a machine/);
  });

  it('leaves other items, foreign rows and lines this replica does not run to the gateway', () => {
    expect(answerRefusal(row(), 'note', { args: [1] }, runs(lineWith()))).toBeNull();
    expect(answerRefusal({ id: 'x', metadata: {} }, 'answer', { args: [1] }, runs(lineWith()))).toBeNull();
    expect(answerRefusal(row(), 'answer', { args: [1] }, runs(undefined))).toBeNull();
  });
});
