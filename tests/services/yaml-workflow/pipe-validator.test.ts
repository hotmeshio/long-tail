import { describe, it, expect } from 'vitest';
import { validatePipeStructure, repairPipeStructure } from '../../../services/yaml-workflow/pipe-validator';

const validYaml = `
app:
  id: longtailapi
  version: '1'
  graphs:
    - subscribes: test.topic
      activities:
        trigger_abc:
          type: trigger
        fetch_abc:
          type: worker
          input:
            maps:
              value:
                '@pipe':
                  - ['{source_abc.output.data.name}', '-suffix']
                  - ['{@string.concat}']
`;

const nestedPipeYaml = `
app:
  id: longtailapi
  version: '1'
  graphs:
    - subscribes: test.topic
      activities:
        trigger_abc:
          type: trigger
        fetch_abc:
          type: worker
          input:
            maps:
              key:
                '@pipe':
                  - '@pipe':
                      - ['{trigger_abc.output.data.domain}']
                  - '@pipe':
                      - ['{trigger_abc.output.data.id}']
                  - ['{@string.concat}']
`;

describe('validatePipeStructure', () => {
  it('passes valid flat @pipe', () => {
    expect(() => validatePipeStructure(validYaml)).not.toThrow();
  });

  it('passes valid nested sub-pipe', () => {
    expect(() => validatePipeStructure(nestedPipeYaml)).not.toThrow();
  });

  it('throws on bare string row', () => {
    const bad = validYaml.replace("- ['{@string.concat}']", "- '{@string.concat}'");
    expect(() => validatePipeStructure(bad)).toThrow(/bare string/);
  });

  it('throws on double-nested array row', () => {
    const bad = `
app:
  id: longtailapi
  version: '1'
  graphs:
    - subscribes: test.topic
      activities:
        t:
          type: trigger
        a:
          type: worker
          input:
            maps:
              v:
                '@pipe':
                  - - ['{t.output.data.x}']
                    - ['{t.output.data.y}']
                  - ['{@string.concat}']
`;
    expect(() => validatePipeStructure(bad)).toThrow(/double-nested/);
  });

  it('throws on @pipe value that is not a sequence', () => {
    const bad = `
app:
  id: longtailapi
  version: '1'
  graphs:
    - subscribes: test.topic
      activities:
        t:
          type: trigger
        a:
          type: worker
          input:
            maps:
              v:
                '@pipe': '{@string.concat}'
`;
    expect(() => validatePipeStructure(bad)).toThrow(/must be a sequence/);
  });

  it('throws on YAML parse error', () => {
    expect(() => validatePipeStructure('{{{')).toThrow(/YAML parse error/);
  });
});

describe('repairPipeStructure', () => {
  it('returns valid YAML unchanged', () => {
    const result = repairPipeStructure(validYaml);
    expect(() => validatePipeStructure(result)).not.toThrow();
  });

  it('wraps bare string rows in arrays', () => {
    const bad = validYaml.replace("- ['{@string.concat}']", "- '{@string.concat}'");
    const fixed = repairPipeStructure(bad);
    expect(() => validatePipeStructure(fixed)).not.toThrow();
    expect(fixed).toContain('@string.concat');
  });

  it('wraps bare numeric scalar rows in arrays', () => {
    const bad = `
app:
  id: longtailapi
  version: '1'
  graphs:
    - subscribes: t
      activities:
        t:
          type: trigger
        a:
          type: worker
          input:
            maps:
              v:
                '@pipe':
                  - ['{t.output.data.val}', 0, 10]
                  - 42
                  - ['{@math.add}']
`;
    const fixed = repairPipeStructure(bad);
    expect(() => validatePipeStructure(fixed)).not.toThrow();
  });

  it('still throws on unfixable double-nested array', () => {
    const bad = `
app:
  id: longtailapi
  version: '1'
  graphs:
    - subscribes: t
      activities:
        t:
          type: trigger
        a:
          type: worker
          input:
            maps:
              v:
                '@pipe':
                  - - ['{t.output.data.x}']
                    - ['{t.output.data.y}']
                  - ['{@string.concat}']
`;
    expect(() => repairPipeStructure(bad)).toThrow(/double-nested/);
  });
});
