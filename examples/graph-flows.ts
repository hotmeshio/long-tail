import type { LTGraphWorkflowConfig } from '../types/startup';

/**
 * Hello World graph flow — the graph-form peer of the `basicEcho` durable workflow.
 *
 * Three-step DAG:
 *   1. trigger  — assembles the greeting, maps name / sleepSeconds / _scope into job data
 *   2. sleeper  — durable timer: blocks for sleepSeconds (mirrors Durable.workflow.sleep)
 *   3. echo     — carries the IAM identity context (_scope) into the output
 *
 * Authored as hand-written YAML. No MCP, no LLM — same result as the procedural form,
 * roughly 3× faster at runtime.
 */
const HELLO_WORLD_YAML = `
app:
  id: graph
  version: '2'
  graphs:
    - subscribes: hello_world
      publishes: hello_world.done
      expire: 120
      input:
        schema:
          type: object
          properties:
            name:
              type: string
              description: Who to greet
              default: world
            sleepSeconds:
              type: number
              description: Pause duration before the echo step
              default: 1
      output:
        schema:
          type: object
          properties:
            greeting:
              type: string
              description: The assembled greeting
            identity:
              type: object
              description: IAM identity context carried through _scope
      activities:
        trigger:
          title: Greet
          type: trigger
          job:
            maps:
              name: '{$self.input.data.name}'
              sleepSeconds:
                '@pipe':
                  - ['{$self.input.data.sleepSeconds}', 1]
                  - ['{@conditional.nullish}']
              _scope: '{$self.input.data._scope}'
              greeting:
                '@pipe':
                  - ['Hello, ', '{$self.input.data.name}', '!']
                  - ['{@string.concat}']
        sleeper:
          title: Pause
          type: hook
          sleep: '{$job.data.sleepSeconds}'
        echo:
          title: Echo
          type: hook
          job:
            maps:
              identity: '{$job.data._scope}'
      transitions:
        trigger:
          - to: sleeper
        sleeper:
          - to: echo
`;

export const EXAMPLE_GRAPH_WORKFLOWS: LTGraphWorkflowConfig[] = [
  {
    name: 'hello_world',
    description: 'Greets a name with a message the graph assembles as it runs.',
    namespace: 'graph',
    yaml: HELLO_WORLD_YAML,
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Who to greet', default: 'world' },
        sleepSeconds: { type: 'number', description: 'Pause duration before the echo step', default: 1 },
      },
      required: ['name'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        greeting: { type: 'string', description: 'The assembled greeting' },
        identity: { type: 'object', description: 'IAM identity context carried through _scope' },
      },
    },
    tags: ['example', 'hello-world'],
  },
];
