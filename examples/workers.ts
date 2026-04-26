import * as reviewContentWorkflow from './workflows/review-content';
import * as kitchenSinkWorkflow from './workflows/kitchen-sink';
import * as basicEchoWorkflow from './workflows/basic-echo';
import * as assemblyLineWorkflow from './workflows/assembly-line';
import * as workstationWorkflow from './workflows/assembly-line/worker';
import * as stepIteratorWorkflow from './workflows/assembly-line/iterator';
import * as reverterWorkflow from './workflows/assembly-line/reverter';

/**
 * Example workers that ship with Long Tail.
 * Pass these to `start({ workers: [...exampleWorkers] })` or enable
 * via `examples: true` in the start config.
 */
export const exampleWorkers = [
  { taskQueue: 'long-tail-examples', workflow: reviewContentWorkflow.reviewContent },
  { taskQueue: 'long-tail-examples', workflow: kitchenSinkWorkflow.kitchenSink },
  { taskQueue: 'long-tail-examples', workflow: basicEchoWorkflow.basicEcho },
  { taskQueue: 'long-tail-examples', workflow: assemblyLineWorkflow.assemblyLine },
  { taskQueue: 'long-tail-examples', workflow: workstationWorkflow.workstation },
  { taskQueue: 'long-tail-examples', workflow: stepIteratorWorkflow.stepIterator },
  { taskQueue: 'long-tail-examples', workflow: reverterWorkflow.reverter },
];
