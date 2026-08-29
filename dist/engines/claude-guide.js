"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ClaudeGuide = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const chalk_1 = __importDefault(require("chalk"));
class ClaudeGuide {
    static getClaudeMdTemplate() {
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
    static generateClaudeMd(targetDir = process.cwd()) {
        try {
            const claudeMdPath = path_1.default.join(targetDir, 'CLAUDE.md');
            if (!fs_1.default.existsSync(claudeMdPath)) {
                fs_1.default.writeFileSync(claudeMdPath, this.getClaudeMdTemplate(), 'utf-8');
                return true;
            }
            return false;
        }
        catch {
            return false;
        }
    }
    static printGuide() {
        console.log(chalk_1.default.bold.cyan('\n📖 Open Gravity — Built-in Claude Code Guide\n'));
        console.log(`  ${chalk_1.default.bold.white('1. Launching Claude Code Separately:')}`);
        console.log(`     Start Open Gravity in one terminal, then in any other terminal run:`);
        console.log(`     ${chalk_1.default.green('claude')}\n`);
        console.log(`  ${chalk_1.default.bold.white('2. Authentication & Onboarding Bypass:')}`);
        console.log(`     Open Gravity automatically configures ${chalk_1.default.cyan('~/.claude.json')} so Anthropic's`);
        console.log(`     OAuth login and onboarding prompts are permanently bypassed.\n`);
        console.log(`  ${chalk_1.default.bold.white('3. Environment Variables (if running in isolated shell):')}`);
        console.log(`     • ${chalk_1.default.yellow('$env:ANTHROPIC_BASE_URL')} = ${chalk_1.default.green('"http://127.0.0.1:8080"')}`);
        console.log(`     • ${chalk_1.default.yellow('$env:ANTHROPIC_API_KEY')}  = ${chalk_1.default.green('"sk-ant-api03-open-gravity-bypass"')}\n`);
        console.log(`  ${chalk_1.default.bold.white('4. CLAUDE.md in Your Projects:')}`);
        console.log(`     Run ${chalk_1.default.cyan('open-gravity configure')} in any project directory to auto-generate`);
        console.log(`     a tailored ${chalk_1.default.cyan('CLAUDE.md')} optimizing tool calling and reasoning.\n`);
    }
}
exports.ClaudeGuide = ClaudeGuide;
//# sourceMappingURL=claude-guide.js.map