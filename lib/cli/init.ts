import * as fs from 'fs';
import * as path from 'path';
import pc from 'picocolors';

const ENV_TEMPLATE = `# Long Tail Compiler Configuration
# Set your LLM API key to enable compilation

ANTHROPIC_API_KEY=
# OPENAI_API_KEY=

# Optional: override default model
# LT_LLM_MODEL_PRIMARY=claude-sonnet-4-6
`;

export function initCommand(): void {
  const envPath = path.resolve(process.cwd(), '.env');

  if (fs.existsSync(envPath)) {
    console.log(`\n  ${pc.yellow('⚠')} .env already exists — not overwriting.\n`);
    return;
  }

  fs.writeFileSync(envPath, ENV_TEMPLATE, 'utf-8');
  console.log(`\n  ${pc.green('✓')} Created .env`);
  console.log(pc.dim('    Add your ANTHROPIC_API_KEY and run ltc compile.\n'));
}
