import { defineConfig, mergeConfig } from 'vitest/config';

import base from './vitest.config';

// Fast backend tests: no workflow suites, no LLM tests, no provider keys.
// Blank keys keep any code path that would call a model on its keyless branch.
export default mergeConfig(base, defineConfig({
  test: {
    exclude: ['tests/workflows/**'],
    env: {
      ANTHROPIC_API_KEY: '',
      OPENAI_API_KEY: '',
      LT_LLM_API_KEY: '',
      CLAUDE_CODE_OAUTH_TOKEN: '',
    },
  },
}));
