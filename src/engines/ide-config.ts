import fs from 'fs';
import path from 'path';
import os from 'os';
import { logger } from '../utils/logger';
import { configManager } from '../utils/config';
import { ClaudeLauncher } from './claude-launcher';

export interface ConfigResult {
  ide: string;
  filePath: string;
  success: boolean;
  message: string;
}

export class IdeConfigurator {
  public static configureAll(workspaceDir?: string): ConfigResult[] {
    return [
      this.configureCursor(workspaceDir),
      this.configureContinue(),
      this.configureAider(workspaceDir),
      this.configureClaudeCode(),
      this.configureVSCode(workspaceDir),
    ];
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
      settings['cursor.openAiApiKey'] = 'gravity-bridge';
      settings['cursor.overrideOpenAiBaseUrl'] = true;
      settings['cursor.customModels'] = [
        'gemini-3.7-flash-high',
        'claude-sonnet-4-6',
        'gemini-pro-agent',
        'gemini-3.7-flash-low',
        'gpt-oss-120b-medium',
      ];

      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');

      // Also create .cursorrules in current workspace if present
      if (workspaceDir && fs.existsSync(workspaceDir)) {
        const rulesPath = path.join(workspaceDir, '.cursorrules');
        const rulesContent = `# Open Gravity Configuration\n# Base URL: ${openaiUrl}\n# Default Model: gemini-3.7-flash-high\n`;
        if (!fs.existsSync(rulesPath)) {
          fs.writeFileSync(rulesPath, rulesContent, 'utf-8');
        }
      }

      return {
        ide: 'Cursor',
        filePath: settingsPath,
        success: true,
        message: `Injected Open Gravity OpenAI endpoint (${openaiUrl}) and model catalog into Cursor settings.`,
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
          apiKey: 'gravity-bridge',
        },
        {
          title: 'Antigravity Claude Sonnet',
          provider: 'openai',
          model: 'claude-sonnet-4-6',
          apiBase: openaiUrl,
          apiKey: 'gravity-bridge',
        },
        {
          title: 'Antigravity Gemini Pro Agent',
          provider: 'openai',
          model: 'gemini-pro-agent',
          apiBase: openaiUrl,
          apiKey: 'gravity-bridge',
        },
      ];

      // Filter out previous duplicate Open Gravity models
      configJson.models = configJson.models.filter((m: any) => !m.title?.startsWith('Antigravity'));
      configJson.models.unshift(...ogModels);

      fs.writeFileSync(continuePath, JSON.stringify(configJson, null, 2), 'utf-8');

      return {
        ide: 'Continue.dev',
        filePath: continuePath,
        success: true,
        message: `Added Antigravity models to Continue.dev configuration.`,
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
      const aiderYaml = `# Open Gravity configuration for Aider\nopenai-api-base: ${openaiUrl}\nopenai-api-key: gravity-bridge\nmodel: openai/gemini-3.7-flash-high\nstream: true\n`;
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

  public static configureClaudeCode(): ConfigResult {
    const config = configManager.get();
    const anthropicUrl = `http://${config.host}:${config.port}`;
    const home = os.homedir();

    try {
      // 1. Inject complete login bypass into ~/.claude.json
      ClaudeLauncher.bypassLoginAndPrepareConfig();

      // 2. Create a ready-to-run wrapper batch script in user directory
      const batPath = path.join(home, 'claude-og.bat');
      const batContent = `@echo off\nset ANTHROPIC_BASE_URL=${anthropicUrl}\nset ANTHROPIC_API_KEY=sk-ant-api03-gravity-bridge-bypass-key-1234567890\nset CLAUDE_BASE_URL=${anthropicUrl}\nset DISABLE_AUTOUPDATES=1\nclaude %*\n`;
      fs.writeFileSync(batPath, batContent, 'utf-8');

      // 3. Create shortcut in project directory if exists
      const projBat = path.join(process.cwd(), 'claude-og.bat');
      fs.writeFileSync(projBat, batContent, 'utf-8');

      // 4. Also create shell script for Git Bash / WSL
      const shPath = path.join(home, 'claude-og.sh');
      const shContent = `#!/usr/bin/env bash\nexport ANTHROPIC_BASE_URL="${anthropicUrl}"\nexport ANTHROPIC_API_KEY="sk-ant-api03-gravity-bridge-bypass-key-1234567890"\nexport CLAUDE_BASE_URL="${anthropicUrl}"\nexport DISABLE_AUTOUPDATES="1"\nclaude "$@"\n`;
      fs.writeFileSync(shPath, shContent, 'utf-8');

      return {
        ide: 'Claude Code',
        filePath: batPath,
        success: true,
        message: `Injected login bypass into ~/.claude.json & created 'claude-og' launcher.`,
      };
    } catch (e: any) {
      return {
        ide: 'Claude Code',
        filePath: home,
        success: false,
        message: e.message,
      };
    }
  }

  public static configureVSCode(workspaceDir?: string): ConfigResult {
    const config = configManager.get();
    const openaiUrl = `http://${config.host}:${config.port}/v1`;

    let settingsPath = '';
    if (workspaceDir && fs.existsSync(workspaceDir)) {
      const vscodeDir = path.join(workspaceDir, '.vscode');
      if (!fs.existsSync(vscodeDir)) fs.mkdirSync(vscodeDir, { recursive: true });
      settingsPath = path.join(vscodeDir, 'settings.json');
    } else {
      if (process.platform === 'win32') {
        const appdata = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
        settingsPath = path.join(appdata, 'Code', 'User', 'settings.json');
      } else if (process.platform === 'darwin') {
        settingsPath = path.join(os.homedir(), 'Library', 'Application Support', 'Code', 'User', 'settings.json');
      } else {
        settingsPath = path.join(os.homedir(), '.config', 'Code', 'User', 'settings.json');
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
        message: `Updated VS Code settings at ${settingsPath}`,
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
}
