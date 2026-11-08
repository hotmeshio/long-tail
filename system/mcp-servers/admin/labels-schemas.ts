import { z } from 'zod';

const tone = z.enum(['solid', 'outline', 'plain']);
const symbology = z.enum(['code128', 'qrcode', 'datamatrix']);

export const listLabelTemplatesSchema = z.object({
  scheme: z.number().int().optional().describe('Only templates for this scan scheme version'),
});

export const upsertLabelTemplateSchema = z.object({
  name: z.string().describe('Template id: lowercase letters, digits and dashes'),
  scheme_version: z.number().int().describe('The scan scheme whose codes the label prints'),
  title: z.string().describe('Display name in pickers'),
  description: z.string().optional(),
  codes: z.array(z.object({
    category: z.string().describe('A rule category of the scheme, 0-9'),
    caption: z.string().optional().describe('The act printed beside the code; defaults to the rule name'),
    tone: tone.describe('Caption band: solid (filled), outline, or plain'),
  })).min(1).max(4),
  text: z.object({
    title: z.string().optional().describe('Largest line, in label tokens: {target}, {item.<facet>}, {user.<key>}, {scheme.name}'),
    lines: z.array(z.string()).max(2).optional(),
  }).optional(),
  symbology: symbology.optional(),
  human_readable: z.boolean().optional().describe('Print the code as text under the symbol'),
  media: z.string().optional().describe('Default media preset id, e.g. a4-l7160'),
  sensitive: z.boolean().optional().describe('Ask for confirmation and record subjects when printing'),
  enabled: z.boolean().optional(),
  expected_revision: z.number().int().optional().describe('Write only if the stored revision matches'),
});

export const deleteLabelTemplateSchema = z.object({
  name: z.string(),
});

export const renderLabelSheetSchema = z.object({
  template: z.string().describe('Label template name'),
  source: z.union([
    z.object({ kind: z.literal('list'), text: z.string().describe('One target per line; a header row starting with "target" names {item.<column>} tokens') }),
    z.object({ kind: z.literal('range'), prefix: z.string().optional(), from: z.number().int(), to: z.number().int(), pad: z.number().int().optional(), suffix: z.string().optional() }),
    z.object({ kind: z.literal('escalations'), ids: z.array(z.string()) }),
    z.object({ kind: z.literal('facets'), query: z.record(z.string(), z.any()).describe('A FacetQuery: role, facets, …') }),
  ]),
  media: z.string().optional().describe('Media preset id; defaults to the template media'),
  startPosition: z.number().int().optional(),
  copies: z.number().int().optional(),
  format: z.enum(['pdf', 'zpl']).describe('pdf for sheet stock, zpl for thermal media'),
});
