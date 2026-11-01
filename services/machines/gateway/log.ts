import { publishMachineLogEvent } from '../../../lib/events/publish';

export const GATEWAY_LOG = {
  STARTED: 'machine_gateway.started',
  RECONCILED: 'machine_gateway.reconciled',
  DISPATCHED: 'machine_gateway.dispatch.accepted',
  DISPATCH_REFUSED: 'machine_gateway.dispatch.refused',
  DISPATCH_READY: 'machine_gateway.dispatch.ready',
  DISPATCH_PREPARING: 'machine_gateway.dispatch.preparing',
  DISPATCH_FAILED: 'machine_gateway.dispatch.failed',
  DISPATCH_RECONCILED: 'machine_gateway.dispatch.reconciled',
  VERB_INVALID: 'machine_gateway.verb.invalid',
  VERB_FAILED: 'machine_gateway.verb.failed',
  ROW_NOT_VISIBLE: 'machine_gateway.verb.row_not_visible',
  ROW_CLAIMED_ELSEWHERE: 'machine_gateway.verb.row_claimed_elsewhere',
  UNMATCHED: 'machine_gateway.message.unmatched',
  UNREADABLE: 'machine_gateway.message.unreadable',
  CONTRACT_VIOLATION: 'machine_gateway.contract.violation',
  VIOLATION_ROW: 'machine_gateway.contract.row_created',
  ADDRESS_BOUND: 'machine_gateway.address.bound',
  ADDRESS_CONTESTED: 'machine_gateway.address.contested',
  ADDRESS_UNKNOWN: 'machine_gateway.address.unknown',
  ADDRESS_REFUSED: 'machine_gateway.address.refused',
  RECEIPT_FAILED: 'machine_gateway.receipt.failed',
  ALARM_ROW: 'machine_gateway.alarm.row_created',
  OFFLINE_ROW: 'machine_gateway.offline.row_created',
  QUIET_ROW: 'machine_gateway.quiet.row_created',
  COMMANDED: 'machine_gateway.command.accepted',
  COMMAND_REFUSED: 'machine_gateway.command.refused',
  COMMAND_UNANSWERED: 'machine_gateway.command.unanswered',
  COMMAND_UNSUPPORTED: 'machine_gateway.command.unsupported',
  LEADING: 'machine_gateway.line.leading',
  STANDBY: 'machine_gateway.line.standby',
  LEADERSHIP_LOST: 'machine_gateway.line.leadership_lost',
  START_FAILED: 'machine_gateway.line.start_failed',
} as const;
export type GatewayLogEvent = typeof GATEWAY_LOG[keyof typeof GATEWAY_LOG];

export interface GatewayLog {
  info(event: GatewayLogEvent, context?: Record<string, unknown>): void;
  warn(event: GatewayLogEvent, context?: Record<string, unknown>): void;
  error(event: GatewayLogEvent, context?: Record<string, unknown>): void;
}

export const consoleLog: GatewayLog = {
  info: (event, context) => console.log(JSON.stringify({ level: 'info', event, ...context })),
  warn: (event, context) => console.warn(JSON.stringify({ level: 'warn', event, ...context })),
  error: (event, context) => console.error(JSON.stringify({ level: 'error', event, ...context })),
};

export const silentLog: GatewayLog = { info: () => undefined, warn: () => undefined, error: () => undefined };

type LogLevel = 'info' | 'warn' | 'error';

/** Each entry published as `machine.log.<site>.<line>.<event>` with its context, for the line's dashboard view. */
export function eventsLog(line: { siteId: string; lineId: string }, publish: typeof publishMachineLogEvent = publishMachineLogEvent): GatewayLog {
  const emit = (level: LogLevel) => (event: GatewayLogEvent, context?: Record<string, unknown>) => {
    publish({ siteId: line.siteId, lineId: line.lineId, level, event, context }).catch(() => undefined);
  };
  return { info: emit('info'), warn: emit('warn'), error: emit('error') };
}

/** Every entry goes to each log in turn. */
export function composeLogs(...logs: GatewayLog[]): GatewayLog {
  const each = (level: LogLevel) => (event: GatewayLogEvent, context?: Record<string, unknown>) => {
    for (const log of logs) log[level](event, context);
  };
  return { info: each('info'), warn: each('warn'), error: each('error') };
}
