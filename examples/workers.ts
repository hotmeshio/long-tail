import * as reviewContentWorkflow from './workflows/review-content';
import * as kitchenSinkWorkflow from './workflows/kitchen-sink';
import * as basicEchoWorkflow from './workflows/basic-echo';

/**
 * Example workers that ship with Long Tail.
 * Pass these to `start({ workers: [...exampleWorkers] })` or enable
 * via `examples: true` in the start config.
 */
export const exampleWorkers = [
  { taskQueue: 'long-tail-examples', workflow: reviewContentWorkflow.reviewContent },
  { taskQueue: 'long-tail-examples', workflow: kitchenSinkWorkflow.kitchenSink },
  { taskQueue: 'long-tail-examples', workflow: basicEchoWorkflow.basicEcho },
];
