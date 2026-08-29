import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import { configManager } from '../utils/config';
import { ClaudeLauncher } from './claude-launcher';

export interface ConfigResult {
  ide: string;
  filePath: string;
  success: boolean;
  message: string;
  skipped?: boolean;
}

export class IdeConfigurator {
  public static isCursorInstalled(): boolean {
    const home = os.homedir();
    if (process.platform === 'win32') {
      const appdata = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
      const local = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
      return fs.existsSync(path.join(appdata, 'Cursor')) || fs.existsSync(path.join(local, 'Programs', 'cursor'));
    }
    if (process.platform === 'darwin') {
      return fs.existsSync(path.join(home, 'Library', 'Application Support', 'Cursor')) || fs.existsSync('/Applications/Cursor.app');
    }
    return fs.existsSync(path.join(home, '.config', 'Cursor'));
  }

  public static isVSCodeInstalled(): boolean {
    const home = os.homedir();
    if (process.platform === 'win32') {
      const appdata = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
      return fs.existsSync(path.join(appdata, 'Code'));
    }
    if (process.platform === 'darwin') {
      return fs.existsSync(path.join(home, 'Library', 'Application Support', 'Code')) || fs.existsSync('/Applications/Visual Studio Code.app');
    }
    return fs.existsSync(path.join(home, '.config', 'Code'));
  }

  public static isClaudeCodeInstalled(): boolean {
    const home = os.homedir();
    const candidateExes = [
      path.join(home, '.local', 'bin', 'claude.exe'),
      path.join(home, '.claude', 'bin', 'claude.exe'),
      path.join(home, '.claude.json'),
    ];
    for (const c of candidateExes) {
      if (fs.existsSync(c)) return true;
    }
    try {
      execSync(process.platform === 'win32' ? 'where claude' : 'which claude', { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  public static isAiderInstalled(): boolean {
    try {
      execSync(process.platform === 'win32' ? 'where aider' : 'which aider', { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  public static isContinueInstalled(): boolean {
    const home = os.homedir();
    const cursorExt = path.join(home, '.cursor', 'extensions');
    const vscodeExt = path.join(home, '.vscode', 'extensions');

    if (fs.existsSync(cursorExt)) {
      try {
        if (fs.readdirSync(cursorExt).some(d => d.toLowerCase().includes('continue'))) return true;
      } catch {}
    }
    if (fs.existsSync(vscodeExt)) {
      try {
        if (fs.readdirSync(vscodeExt).some(d => d.toLowerCase().includes('continue'))) return true;
      } catch {}
    }
    return false;
  }

  public static configureAll(workspaceDir?: string): ConfigResult[] {
    const results: ConfigResult[] = [];

    if (this.isCursorInstalled()) {
      results.push(this.configureCursor(workspaceDir));
    }

    if (this.isClaudeCodeInstalled()) {
      results.push(this.configureClaudeCode());
    }

    if (this.isVSCodeInstalled()) {
      results.push(this.configureVSCode(workspaceDir));
    }

    if (this.isContinueInstalled()) {
      results.push(this.configureContinue());
    }

    if (this.isAiderInstalled()) {
      results.push(this.configureAider(workspaceDir));
    }

    return results;
  }

  public static configureCursor(workspaceDir?: string): ConfigResult {
    const config = configManager.get();
    const openaiUrl = `http://${config.host}:${config.port}/v1`;

    let settingsPath = '';
    if (process.platform === 'win32') {
      const appdata = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
      settingsPath = path.join(appdata, 'Cursor', 'User', 'settings.json');
    } else if (process.platform === 'darwin') {
      settingsPath = path.join(os.homedir(), 'Library', 'Application Support', 'Cursor', 'User', 'settings.json');
    } else {
      settingsPath = path.join(os.homedir(), '.config', 'Cursor', 'User', 'settings.json');
    }

    try {
      const dir = path.dirname(settingsPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      let settings: Record<string, any> = {};
      if (fs.existsSync(settingsPath)) {
        try {
          settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
        } catch {
          settings = {};
        }
      }

      settings['cursor.openAiBaseUrl'] = openaiUrl;
      settings['cursor.openAiApiKey'] = 'open-gravity';
      settings['cursor.overrideOpenAiBaseUrl'] = true;
      settings['cursor.customModels'] = [
        'gemini-3.7-flash-high',
        'claude-sonnet-4-6',
        'gemini-pro-agent',
        'gemini-3.7-flash-low',
        'gpt-oss-120b-medium',
      ];

      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');

      return {
        ide: 'Cursor',
        filePath: settingsPath,
        success: true,
        message: `Injected Open Gravity endpoint (${openaiUrl})`,
      };
    } catch (e: any) {
      return {
        ide: 'Cursor',
        filePath: settingsPath,
        success: false,
        message: e.message,
      };
    }
  }

  public static configureClaudeCode(): ConfigResult {
    const home = os.homedir();
    const claudeJsonPath = path.join(home, '.claude.json');

    try {
      ClaudeLauncher.applyLoginBypass();

      return {
        ide: 'Claude Code',
        filePath: claudeJsonPath,
        success: true,
        message: `Injected login bypass into ~/.claude.json`,
      };
    } catch (e: any) {
      return {
        ide: 'Claude Code',
        filePath: claudeJsonPath,
        success: false,
        message: e.message,
      };
    }
  }

  public static configureVSCode(workspaceDir?: string): ConfigResult {
    let settingsPath = '';
    if (workspaceDir && fs.existsSync(workspaceDir)) {
      const vscodeDir = path.join(workspaceDir, '.vscode');
      if (!fs.existsSync(vscodeDir)) fs.mkdirSync(vscodeDir, { recursive: true });
      settingsPath = path.join(vscodeDir, 'settings.json');
    } else {
      const home = os.homedir();
      if (process.platform === 'win32') {
        const appdata = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
        settingsPath = path.join(appdata, 'Code', 'User', 'settings.json');
      } else if (process.platform === 'darwin') {
        settingsPath = path.join(home, 'Library', 'Application Support', 'Code', 'User', 'settings.json');
      } else {
        settingsPath = path.join(home, '.config', 'Code', 'User', 'settings.json');
      }
    }

    try {
      const dir = path.dirname(settingsPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      let settings: Record<string, any> = {};
      if (fs.existsSync(settingsPath)) {
        try {
          settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
        } catch {
          settings = {};
        }
      }

      settings['github.copilot.advanced'] = {
        debug: {
          overrideEngine: 'gemini-3.7-flash-high',
        },
      };

      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');

      return {
        ide: 'VS Code',
        filePath: settingsPath,
        success: true,
        message: `Updated VS Code settings`,
      };
    } catch (e: any) {
      return {
        ide: 'VS Code',
        filePath: settingsPath,
        success: false,
        message: e.message,
      };
    }
  }

  public static configureContinue(): ConfigResult {
    const config = configManager.get();
    const openaiUrl = `http://${config.host}:${config.port}/v1`;
    const continueDir = path.join(os.homedir(), '.continue');
    const continuePath = path.join(continueDir, 'config.json');

    try {
      if (!fs.existsSync(continueDir)) fs.mkdirSync(continueDir, { recursive: true });

      let configJson: any = { models: [] };
      if (fs.existsSync(continuePath)) {
        try {
          configJson = JSON.parse(fs.readFileSync(continuePath, 'utf-8'));
          if (!Array.isArray(configJson.models)) configJson.models = [];
        } catch {
          configJson = { models: [] };
        }
      }

      const ogModels = [
        {
          title: 'Antigravity Gemini 3.7 Flash High',
          provider: 'openai',
          model: 'gemini-3.7-flash-high',
          apiBase: openaiUrl,
          apiKey: 'open-gravity',
        },
      ];

      configJson.models = configJson.models.filter((m: any) => !m.title?.startsWith('Antigravity'));
      configJson.models.unshift(...ogModels);

      fs.writeFileSync(continuePath, JSON.stringify(configJson, null, 2), 'utf-8');

      return {
        ide: 'Continue.dev',
        filePath: continuePath,
        success: true,
        message: `Updated Continue.dev configuration.`,
      };
    } catch (e: any) {
      return {
        ide: 'Continue.dev',
        filePath: continuePath,
        success: false,
        message: e.message,
      };
    }
  }

  public static configureAider(workspaceDir?: string): ConfigResult {
    const config = configManager.get();
    const openaiUrl = `http://${config.host}:${config.port}/v1`;
    const targetDir = workspaceDir || os.homedir();
    const aiderPath = path.join(targetDir, '.aider.conf.yml');

    try {
      const aiderYaml = `openai-api-base: ${openaiUrl}\nopenai-api-key: open-gravity\nmodel: openai/gemini-3.7-flash-high\nstream: true\n`;
      fs.writeFileSync(aiderPath, aiderYaml, 'utf-8');

      return {
        ide: 'Aider',
        filePath: aiderPath,
        success: true,
        message: `Created .aider.conf.yml pointing to ${openaiUrl}`,
      };
    } catch (e: any) {
      return {
        ide: 'Aider',
        filePath: aiderPath,
        success: false,
        message: e.message,
      };
    }
  }
}
