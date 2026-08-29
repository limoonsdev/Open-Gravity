import fs from 'fs';
import path from 'path';
import chalk from 'chalk';

export class ClaudeGuide {
  public static getClaudeMdTemplate(): string {
    return `# Claude Code Configuration for Open Gravity

## Runtime Environment
- **Provider**: Google Antigravity Bridge (Open Gravity)
- **Architecture**: Antigravity Live Reasoning Engine
- **Tool Calling**: Native Bash, Glob, FileRead, FileEdit, Grep

## Operating Principles
1. **Direct Execution**: When a tool is needed (Bash command, FileRead, FileEdit), call the tool immediately without unnecessary conversational preamble.
2. **Concise Responses**: Provide clear, dense, actionable explanations. Avoid repeating prompt text or restating entire files.
3. **Accurate Diffs**: When editing files, replace only the required code chunks accurately without breaking syntax.
`;
  }

  public static generateClaudeMd(targetDir: string = process.cwd()): boolean {
    try {
      const claudeMdPath = path.join(targetDir, 'CLAUDE.md');
      if (!fs.existsSync(claudeMdPath)) {
        fs.writeFileSync(claudeMdPath, this.getClaudeMdTemplate(), 'utf-8');
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  public static printGuide(): void {
    console.log(chalk.bold.cyan('\n📖 Open Gravity — Built-in Claude Code Guide\n'));
    console.log(`  ${chalk.bold.white('1. Launching Claude Code Separately:')}`);
    console.log(`     Start Open Gravity in one terminal, then in any other terminal run:`);
    console.log(`     ${chalk.green('claude')}\n`);

    console.log(`  ${chalk.bold.white('2. Authentication & Onboarding Bypass:')}`);
    console.log(`     Open Gravity automatically configures ${chalk.cyan('~/.claude.json')} so Anthropic's`);
    console.log(`     OAuth login and onboarding prompts are permanently bypassed.\n`);

    console.log(`  ${chalk.bold.white('3. Environment Variables (if running in isolated shell):')}`);
    console.log(`     • ${chalk.yellow('$env:ANTHROPIC_BASE_URL')} = ${chalk.green('"http://127.0.0.1:8080"')}`);
    console.log(`     • ${chalk.yellow('$env:ANTHROPIC_API_KEY')}  = ${chalk.green('"sk-ant-api03-open-gravity-bypass"')}\n`);

    console.log(`  ${chalk.bold.white('4. CLAUDE.md in Your Projects:')}`);
    console.log(`     Run ${chalk.cyan('open-gravity configure')} in any project directory to auto-generate`);
    console.log(`     a tailored ${chalk.cyan('CLAUDE.md')} optimizing tool calling and reasoning.\n`);
  }
}
