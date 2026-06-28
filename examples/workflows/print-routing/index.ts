/**
 * Print Routing — an enterprise print farm where printers are durable workflows.
 *
 * A two-sided market on one primitive (the escalation queue), four+ actors:
 *
 *   printOrder      DEMAND + convergence owner. Enqueues the order's insoles, parks,
 *                   and reprints any rejected unit through the same funnel until done.
 *   printer         SUPPLY. One durable workflow per machine — advertises itself,
 *                   runs the handed-off job, refills, retires.
 *   printBroker     The market maker. Claims demand by priority, locks supply, hands
 *                   off, harvests, settles.
 *   farmTechnician  Resolves needs-filament adverts.
 *   farmInspector   The farmer. Signs off finished orders (and triggers reprints).
 *   printShift      The invocable entry target. One click runs the whole farm:
 *                   powers on the fleet + dispatcher, feeds order flavors in waves,
 *                   drains, then retires idle machines. Bounded end to end.
 *
 * The directory is the map: `workflows/` (the actors), `activities/` (their side
 * effects), `policy/` (capability, priority, manifest), `types.ts`. See README.md.
 */

export {
  printOrder,
  printer,
  printBroker,
  farmTechnician,
  farmInspector,
  printShift,
} from './workflows';
