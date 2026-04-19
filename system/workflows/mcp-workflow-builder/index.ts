import { Durable } from '@hotmeshio/hotmesh';

import type { LTEnvelope, LTReturn } from '../../../types';
import * as activities from './activities';
import { BUILDER_SYSTEM_PROMPT, REFINE_PROMPT } from './prompts';

type ActivitiesType = typeof activities;

const {
  loadBuilderTools,
  callBuilderLLM,
} = Durable.workflow.proxyActivities<ActivitiesType>({
  activities,
  retry: {
    maximumAttempts: 3,
    backoffCoefficient: 2,
    maximumInterval: '10 seconds',
  },
});

const MAX_BUILD_ATTEMPTS = 3;
const MAX_CLARIFICATION_ROUNDS = 3;

/**
 * MCP Workflow Builder — constructs HotMesh YAML DAGs directly.
 *
 * Unlike mcpQuery (which executes tools then compiles traces), this workflow
 * reasons about tool schemas and builds the YAML declaratively. The LLM
 * knows HotMesh's activity types, mapping syntax, and @pipe operators.
 *
 * Supports conversational clarification: when the prompt is ambiguous,
 * the LLM returns questions instead of YAML. The user answers, and the
 * exchange continues until the LLM has enough to build.
 *
 * Returns the generated YAML, input schema, and activity manifest —
 * ready for deployment via the existing yaml-workflow infrastructure.
 */
export async function mcpWorkflowBuilder(
  envelope: LTEnvelope,
): Promise<LTReturn> {
  const prompt = (envelope.data?.prompt || envelope.data?.question) as string;
  const tags = envelope.data?.tags as string[] | undefined;
  const feedback = envelope.data?.feedback as string | undefined;
  const priorYaml = envelope.data?.prior_yaml as string | undefined;
  const answers = envelope.data?.answers as string | undefined;
  const priorQuestions = envelope.data?.prior_questions as string[] | undefined;

  if (!prompt) {
    return {
      type: 'return',
      data: {
        title: 'No prompt provided',
        summary: 'Describe the workflow you want to build.',
        result: null,
      },
    };
  }

  // 1. Discover available MCP tools
  const raw = await loadBuilderTools(tags);

  // 2. Build system prompt with HotMesh spec + tool inventory
  const serverSection = [
    raw.strategy ? `${raw.strategy}\n` : '',
    `## Available MCP Servers & Tools\n\n${raw.inventory}`,
  ].filter(Boolean).join('\n');

  const messages: any[] = [
    {
      role: 'system',
      content: BUILDER_SYSTEM_PROMPT(serverSection),
    },
  ];

  // If refining a prior attempt, inject context
  if (feedback && priorYaml) {
    messages.push({
      role: 'user',
      content: `Build a workflow for: ${prompt}`,
    });
    messages.push({
      role: 'assistant',
      content: `Here is the prior YAML that needs fixing:\n\`\`\`yaml\n${priorYaml.slice(0, 3000)}\n\`\`\``,
    });
    messages.push({
      role: 'user',
      content: `${REFINE_PROMPT}\n\nExecution feedback:\n${feedback}`,
    });
  } else if (answers && priorQuestions?.length) {
    // Continuing a clarification conversation
    messages.push({
      role: 'user',
      content: `Build a workflow for: ${prompt}`,
    });
    messages.push({
      role: 'assistant',
      content: JSON.stringify({ clarification_needed: true, questions: priorQuestions }),
    });
    messages.push({
      role: 'user',
      content: `Here are my answers:\n${answers}\n\nNow build the workflow YAML.`,
    });
  } else {
    messages.push({
      role: 'user',
      content: `Build a workflow for: ${prompt}`,
    });
  }

  // 3. Ask the LLM to construct the YAML (with retry on parse failure)
  for (let attempt = 0; attempt < MAX_BUILD_ATTEMPTS; attempt++) {
    const response = await callBuilderLLM(messages, undefined);
    const content = response.content || '';

    // Parse the JSON response
    const cleaned = content
      .replace(/^```(?:json)?\s*/m, '')
      .replace(/\s*```$/m, '')
      .trim();

    try {
      const result = JSON.parse(cleaned);

      // Clarification response — LLM needs more info before building
      if (result.clarification_needed && Array.isArray(result.questions)) {
        return {
          type: 'return',
          data: {
            title: 'Clarification Needed',
            summary: 'The builder needs more information before constructing the workflow.',
            clarification_needed: true,
            questions: result.questions,
            tools_identified: result.tools_identified || [],
          },
          milestones: [
            { name: 'workflow_builder', value: 'clarification' },
          ],
        };
      }

      if (!result.yaml || !result.name) {
        messages.push({ role: 'assistant', content });
        messages.push({
          role: 'user',
          content: 'Response is missing required fields. Return a JSON object with: name, description, yaml, input_schema, activity_manifest, tags, sample_inputs. Or if you need more information, return { "clarification_needed": true, "questions": ["..."] }.',
        });
        continue;
      }

      return {
        type: 'return',
        data: {
          title: `Workflow: ${result.name}`,
          summary: result.description || 'Workflow built successfully.',
          name: result.name,
          description: result.description,
          yaml: result.yaml,
          input_schema: result.input_schema,
          activity_manifest: result.activity_manifest,
          tags: result.tags,
          sample_inputs: result.sample_inputs,
          build_attempts: attempt + 1,
        },
        milestones: [
          { name: 'workflow_builder', value: 'completed' },
          { name: 'build_attempts', value: String(attempt + 1) },
        ],
      };
    } catch {
      messages.push({ role: 'assistant', content });
      messages.push({
        role: 'user',
        content: 'Invalid JSON. Return a single JSON object (no markdown fences) with: name, description, yaml, input_schema, activity_manifest, tags, sample_inputs.',
      });
    }
  }

  return {
    type: 'return',
    data: {
      title: 'Build Failed',
      summary: 'Could not generate valid workflow YAML after multiple attempts.',
      result: null,
    },
  };
}
