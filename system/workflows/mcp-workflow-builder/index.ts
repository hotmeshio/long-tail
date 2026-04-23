import { Durable } from '@hotmeshio/hotmesh';

import type { LTEnvelope, LTReturn } from '../../../types';
import * as activities from './activities';
import { BUILDER_SYSTEM_PROMPT, REFINE_PROMPT } from './prompts';

type ActivitiesType = typeof activities;

const {
  loadBuilderTools,
  loadReferenceSection,
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
 * Fix known @pipe anti-patterns in generated YAML.
 *
 * LLMs consistently produce two broken patterns:
 * 1. ['{@date.toISOString}'] then [0, 10] then ['{@string.substring}']
 *    → should be ['{@date.toISOString}', 0, 10] then ['{@string.substring}']
 * 2. Bare static rows like ['.png'] after sub-pipes
 *    → should be wrapped in '@pipe': [['.png']]
 *
 * This runs deterministically on the YAML string before deployment.
 */
function fixPipePatterns(yaml: string): string {
  // Fix pattern 1: function row followed by bare args row followed by another function
  // ['{@date.toISOString}']  →  ['{@date.toISOString}', 0, 10]
  // [0, 10]                     ['{@string.substring}']
  // ['{@string.substring}']
  yaml = yaml.replace(
    /(\['\{@date\.toISOString\}'\])\s*\n(\s*)- \[0, 10\]\s*\n(\s*)- \['\{@string\.substring\}'\]/g,
    "['{@date.toISOString}', 0, 10]\n$2- ['{@string.substring}']",
  );

  // Fix field name mismatches the LLM consistently gets wrong
  // Vision: image_path → image (the tool parameter name)
  yaml = yaml.replace(/(\s+)image_path: /g, '$1image: ');
  // Knowledge: content: '{...}' → data: '{...}' (store_knowledge field)
  yaml = yaml.replace(/(\s+)content: '(\{[^}]+\.output\.data\.[^}]+\})'/g, "$1data: '$2'");
  // Vision output: .analysis} → .description} (analyze_image returns description)
  yaml = yaml.replace(/\.analysis\}/g, '.description}');

  return yaml;
}

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
  const compositionContext = envelope.data?.composition_context as {
    sibling_schemas?: Array<{ name: string; input_schema: Record<string, unknown>; output_schema: Record<string, unknown>; graph_topic: string }>;
    dependencies?: string[];
    namespace?: string;
    requires_await?: boolean;
    requires_signal?: boolean;
  } | undefined;

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

  // 3. Load composition references if this workflow is part of a plan
  const compositionSections: string[] = [];
  if (compositionContext) {
    if (compositionContext.requires_await) {
      const awaitRef = await loadReferenceSection('await');
      if (awaitRef) compositionSections.push(awaitRef);
    }
    if (compositionContext.requires_signal) {
      const signalRef = await loadReferenceSection('signal');
      if (signalRef) compositionSections.push(signalRef);
    }
    if (compositionContext.sibling_schemas?.length) {
      const siblings = compositionContext.sibling_schemas
        .map(s => `- **${s.name}** (topic: \`${s.graph_topic}\`)\n  Input: \`${JSON.stringify(s.input_schema)}\`\n  Output: \`${JSON.stringify(s.output_schema)}\``)
        .join('\n');
      compositionSections.push(
        `## Sibling Workflows in This Plan\n\nThis workflow is part of a multi-workflow set. The following sibling workflows exist in the same namespace and can be invoked using \`type: await\` activities:\n\n${siblings}`,
      );
    }
  }

  const fullInventory = compositionSections.length
    ? `${serverSection}\n\n${compositionSections.join('\n\n')}`
    : serverSection;

  const messages: any[] = [
    {
      role: 'system',
      content: BUILDER_SYSTEM_PROMPT(fullInventory),
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

      // Fix known @pipe anti-patterns before returning
      const fixedYaml = fixPipePatterns(result.yaml);

      return {
        type: 'return',
        data: {
          title: `Workflow: ${result.name}`,
          summary: result.description || 'Workflow built successfully.',
          name: result.name,
          description: result.description,
          yaml: fixedYaml,
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
