/**
 * Printer Twin — the physical/digital twin phase of the print farm.
 *
 * print-routing proves the marketplace at throughput with simulated machines;
 * this example binds each durable workflow to a REAL machine behind a print
 * farm manager host. Three actors on the same escalation primitive:
 *
 *   printerTwin   One durable workflow per physical machine. Registration and
 *                 service escalations are its JIT UI for the print-servicer;
 *                 availability adverts are its market presence; the in-flight
 *                 `printing` row is the physical rendezvous the farm manager's
 *                 callback resolves.
 *   twinOrder     DEMAND. Enqueues one print-job row per unit (one origin
 *                 group), parks until the broker settles the set.
 *   twinBroker    The market maker. Claims demand sized to supply, locks each
 *                 order's printer SET all-or-nothing, tells the farm manager
 *                 to print (env-selected mock | http backend), harvests,
 *                 settles.
 *
 * See README.md for the office connectivity walkthrough and the farm-manager
 * callback contract; see ../print-routing/ARCHITECTURE.md for the marketplace
 * design this builds on.
 */

export { printerTwin, twinOrder, twinBroker } from './workflows';
