import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';
import chalk from 'chalk';
import { configManager } from '../utils/config';
import { AntigravityDiscovery } from './discovery';

export class ClaudeLauncher {
  public static bypassLoginAndPrepareConfig(): string {
    const home = os.homedir();
    const claudeJsonPath = path.join(home, '.claude.json');

    try {
      let config: Record<string, any> = {};
      if (fs.existsSync(claudeJsonPath)) {
        try {
          config = JSON.parse(fs.readFileSync(claudeJsonPath, 'utf-8'));
        } catch {
          config = {};
        }
      }

      // Complete login bypass & onboarding skip payload
      config.hasCompletedOnboarding = true;
      config.autoUpdates = false;
      config.primaryApiKey = 'sk-ant-api03-gravity-bridge-bypass-key-1234567890';
      
      // Trust current working directory if exists
      const cwd = process.cwd();
      if (!config.projects) config.projects = {};
      if (!config.projects[cwd]) {
        config.projects[cwd] = {
          allowedTools: [],
          mcpContextUris: [],
          enabledMcpjsonServers: [],
          disabledMcpjsonServers: [],
          hasTrustDialogAccepted: true,
          hasClaudeMdExternalIncludesApproved: true,
          hasClaudeMdExternalIncludesWarningShown: true,
        };
      } else {
        config.projects[cwd].hasTrustDialogAccepted = true;
        config.projects[cwd].hasClaudeMdExternalIncludesApproved = true;
      }

      fs.writeFileSync(claudeJsonPath, JSON.stringify(config, null, 2), 'utf-8');
      return claudeJsonPath;
    } catch (e: any) {
      return '';
    }
  }

  public static async launchClaude(extraArgs: string[] = []): Promise<void> {
    const config = configManager.get();
    const port = config.port;
    const host = config.host;
    const baseUrl = `http://${host}:${port}`;
    const bypassApiKey = 'sk-ant-api03-gravity-bridge-bypass-key-1234567890';

    console.log(chalk.cyan('\n🚀 [Open Gravity] Preparing Claude Code with Login Bypass...'));

    // 1. Prepare ~/.claude.json bypass
    this.bypassLoginAndPrepareConfig();
    console.log(chalk.green('✔ Authentication bypass injected into ~/.claude.json'));

    // 2. Prepare environment variables
    const env = {
      ...process.env,
      ANTHROPIC_BASE_URL: baseUrl,
      ANTHROPIC_API_KEY: bypassApiKey,
      CLAUDE_BASE_URL: baseUrl,
      DISABLE_AUTOUPDATES: '1',
      NODE_TLS_REJECT_UNAUTHORIZED: '0',
    };

    console.log(chalk.green(`✔ Endpoint routed to: ${chalk.bold(baseUrl)} (Antigravity Bridge)`));
    console.log(chalk.gray('  Launching Claude Code in interactive terminal...\n'));

    // 3. Find Claude command
    const isWin = process.platform === 'win32';
    
    // Command runner
    let cmd = 'claude';
    let args = extraArgs;

    // Check if claude exists in PATH, otherwise use npx @anthropic-ai/claude-code
    const child = isWin
      ? spawn('cmd.exe', ['/c', 'claude', ...args], { env, stdio: 'inherit' })
      : spawn('claude', args, { env, stdio: 'inherit' });

    child.on('error', () => {
      console.log(chalk.yellow('  `claude` command not in PATH, falling back to `npx @anthropic-ai/claude-code`...'));
      const fallback = isWin
        ? spawn('cmd.exe', ['/c', 'npx', '--yes', '@anthropic-ai/claude-code', ...args], { env, stdio: 'inherit' })
        : spawn('npx', ['--yes', '@anthropic-ai/claude-code', ...args], { env, stdio: 'inherit' });

      fallback.on('close', (code) => {
        console.log(chalk.gray(`\n[Claude Code exited with code ${code ?? 0}]`));
      });
    });

    child.on('close', (code) => {
      if (code !== null) {
        console.log(chalk.gray(`\n[Claude Code exited with code ${code}]`));
      }
    });
  }
}
