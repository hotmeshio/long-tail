import type { LTGraphWorkflowConfig } from '../types/startup';

/**
 * A hello-world graph flow — the graph-form peer of an example durable workflow.
 *
 * Pure HotMesh mapping: the trigger concatenates a greeting from the input and
 * returns it as the job output. No worker activity, no MCP server, no LLM — it
 * just runs. This is the "you can author a graph flow without the Designer"
 * proof point, registered the same way durable `workers` are.
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
    description: 'Greets the name you pass in. A graph flow authored by hand — no MCP, no LLM.',
    namespace: 'graph',
    yaml: HELLO_WORLD_YAML,
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Who to greet', default: 'world' },
      },
      required: ['name'],
    },
    tags: ['example', 'hello-world'],
  },
];
