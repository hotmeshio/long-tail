/**
 * The machine line contracts workflow code uses on any engine: row types,
 * facets, decisions, form schemas, command rows and line roles. Nothing
 * behind this module imports Node built-ins, the database or HotMesh, so a
 * Temporal workflow bundle or a DBOS app can import it. Published as
 * `@hotmeshio/long-tail/machines/contracts`.
 */

export * from './contracts';
export * from './commands';
export * from './forms';
export * from './rows';
export * from '../../lib/machines/line-roles';
export type { LineDef, MachineDef } from '../../types/machines';
