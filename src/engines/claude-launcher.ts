import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';
import chalk from 'chalk';
import { configManager } from '../utils/config';

export class ClaudeLauncher {
  public static findClaudeExecutable(): string | null {
    const home = os.homedir();
    const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');

    const candidates = [
      path.join(home, '.local', 'bin', 'claude.exe'),
      path.join(home, '.claude', 'bin', 'claude.exe'),
      path.join(localAppData, 'Programs', 'claude', 'claude.exe'),
      path.join(localAppData, 'Programs', 'Claude', 'claude.exe'),
    ];

    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }

    const packagesDir = path.join(localAppData, 'Packages');
    if (fs.existsSync(packagesDir)) {
      try {
        const pkgs = fs.readdirSync(packagesDir).filter(p => p.startsWith('Claude_'));
        for (const pkg of pkgs) {
          const codeDir = path.join(packagesDir, pkg, 'LocalCache', 'Roaming', 'Claude', 'claude-code');
          if (fs.existsSync(codeDir)) {
            const versions = fs.readdirSync(codeDir);
            for (const v of versions) {
              const exe = path.join(codeDir, v, 'claude.exe');
              if (fs.existsSync(exe)) return exe;
            }
          }
        }
      } catch {}
    }

    return null;
  }

  public static applyLoginBypass(): void {
    const claudeJsonPath = path.join(os.homedir(), '.claude.json');

    try {
      let config: Record<string, any> = {};
      if (fs.existsSync(claudeJsonPath)) {
        try {
          config = JSON.parse(fs.readFileSync(claudeJsonPath, 'utf-8'));
        } catch {
          config = {};
        }
      }

      config.hasCompletedOnboarding = true;
      config.autoUpdates = false;
      config.primaryApiKey = 'sk-ant-api03-open-gravity-bypass';

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
    } catch {}
  }

  public static async launchClaude(extraArgs: string[] = []): Promise<void> {
    const config = configManager.get();
    const baseUrl = `http://${config.host}:${config.port}`;
    const bypassApiKey = 'sk-ant-api03-open-gravity-bypass';

    this.applyLoginBypass();

    const env = {
      ...process.env,
      ANTHROPIC_BASE_URL: baseUrl,
      ANTHROPIC_API_KEY: bypassApiKey,
      CLAUDE_BASE_URL: baseUrl,
      DISABLE_AUTOUPDATES: '1',
      NODE_TLS_REJECT_UNAUTHORIZED: '0',
    };

    const exe = this.findClaudeExecutable();

    if (exe) {
      const child = spawn(exe, extraArgs, { env, stdio: 'inherit' });
      return new Promise((resolve) => {
        child.on('close', () => resolve());
      });
    }

    const isWin = process.platform === 'win32';
    return new Promise((resolve) => {
      const child = isWin
        ? spawn('cmd.exe', ['/c', 'claude', ...extraArgs], { env, stdio: 'inherit' })
        : spawn('claude', extraArgs, { env, stdio: 'inherit' });

      child.on('error', () => {
        const fallback = isWin
          ? spawn('cmd.exe', ['/c', 'npx', '--yes', '@anthropic-ai/claude-code', ...extraArgs], { env, stdio: 'inherit' })
          : spawn('npx', ['--yes', '@anthropic-ai/claude-code', ...extraArgs], { env, stdio: 'inherit' });

        fallback.on('close', () => resolve());
      });

      child.on('close', () => resolve());
    });
  }
}
