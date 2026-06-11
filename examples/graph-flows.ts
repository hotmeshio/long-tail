import type { LTGraphWorkflowConfig } from '../types/startup';

/**
 * A hello-world graph flow — the graph-form peer of an example durable workflow.
 *
 * Pure HotMesh mapping: the trigger assembles a greeting from the input and
 * returns it as the job output. Authored as YAML and registered at startup the
 * same way durable `workers` are.
 */
const HELLO_WORLD_YAML = `
app:
  id: graph
  version: '1'
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
      output:
        schema:
          type: object
          properties:
            greeting:
              type: string
      activities:
        trigger:
          title: Hello World
          type: trigger
          job:
            maps:
              greeting:
                '@pipe':
                  - ['Hello, ', '{$self.input.data.name}', '!']
                  - ['{@string.concat}']
      transitions: {}
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
      },
      required: ['name'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        greeting: { type: 'string', description: 'The assembled greeting' },
      },
    },
    tags: ['example', 'hello-world'],
  },
];
