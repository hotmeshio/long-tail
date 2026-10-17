/**
 * machineCommand: one step that asks a machine to start, stop, pause, resume
 * or change over. It parks a machine-command row on the machine's role and
 * waits, as it would for a person; the gateway sends the command and resolves
 * the row with the machine's reply. The workflow reads the reply as data.
 */

import { conditional } from '../../../../services/orchestrator/condition';
import { commandRow, type CommandTarget } from '../../../../services/machines/commands';
import { COMMAND_STATUS, type CommandResolution } from '../../../../services/machines/contracts';
import type { Op } from '../../../../lib/machines/protocol';
import type { LTEnvelope } from '../../../../types';

export const MACHINE_COMMAND_WORKFLOW = 'machineCommand';

export interface MachineCommandInput extends CommandTarget {
  /** Names this request; part of the signal key. */
  requestKey: string;
  op: Op;
  args?: Record<string, unknown>;
  /** How long to wait for the row to resolve. */
  timeout?: string;
}

export const commandSignalKey = (requestKey: string) => `machine-command-${requestKey}`;

export async function machineCommand(envelope: LTEnvelope): Promise<any> {
  const input = envelope.data as MachineCommandInput;
  const reply = await conditional<CommandResolution>(commandSignalKey(input.requestKey), {
    ...commandRow(input, input.op, input.args ?? {}),
    workflowType: MACHINE_COMMAND_WORKFLOW,
    timeout: input.timeout ?? '10m',
  });
  const data: CommandResolution = reply || {
    accepted: false, machineId: input.machineId, op: input.op, status: COMMAND_STATUS.NO_REPLY, reason: 'the row did not resolve before the timeout',
  };
  return { type: 'return' as const, data };
}
