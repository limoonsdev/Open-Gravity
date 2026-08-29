"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.IdeConfigurator = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const config_1 = require("../utils/config");
const claude_launcher_1 = require("./claude-launcher");
class IdeConfigurator {
    static configureAll(workspaceDir) {
        return [
            this.configureCursor(workspaceDir),
            this.configureContinue(),
            this.configureAider(workspaceDir),
            this.configureClaudeCode(),
            this.configureVSCode(workspaceDir),
        ];
    }
    static configureCursor(workspaceDir) {
        const config = config_1.configManager.get();
        const openaiUrl = `http://${config.host}:${config.port}/v1`;
        let settingsPath = '';
        if (process.platform === 'win32') {
            const appdata = process.env.APPDATA || path_1.default.join(os_1.default.homedir(), 'AppData', 'Roaming');
            settingsPath = path_1.default.join(appdata, 'Cursor', 'User', 'settings.json');
        }
        else if (process.platform === 'darwin') {
            settingsPath = path_1.default.join(os_1.default.homedir(), 'Library', 'Application Support', 'Cursor', 'User', 'settings.json');
        }
        else {
            settingsPath = path_1.default.join(os_1.default.homedir(), '.config', 'Cursor', 'User', 'settings.json');
        }
        try {
            const dir = path_1.default.dirname(settingsPath);
            if (!fs_1.default.existsSync(dir))
                fs_1.default.mkdirSync(dir, { recursive: true });
            let settings = {};
            if (fs_1.default.existsSync(settingsPath)) {
                try {
                    settings = JSON.parse(fs_1.default.readFileSync(settingsPath, 'utf-8'));
                }
                catch {
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
            fs_1.default.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
            // Also create .cursorrules in current workspace if present
            if (workspaceDir && fs_1.default.existsSync(workspaceDir)) {
                const rulesPath = path_1.default.join(workspaceDir, '.cursorrules');
                const rulesContent = `# Open Gravity Configuration\n# Base URL: ${openaiUrl}\n# Default Model: gemini-3.7-flash-high\n`;
                if (!fs_1.default.existsSync(rulesPath)) {
                    fs_1.default.writeFileSync(rulesPath, rulesContent, 'utf-8');
                }
            }
            return {
                ide: 'Cursor',
                filePath: settingsPath,
                success: true,
                message: `Injected Open Gravity OpenAI endpoint (${openaiUrl}) and model catalog into Cursor settings.`,
            };
        }
        catch (e) {
            return {
                ide: 'Cursor',
                filePath: settingsPath,
                success: false,
                message: e.message,
            };
        }
    }
    static configureContinue() {
        const config = config_1.configManager.get();
        const openaiUrl = `http://${config.host}:${config.port}/v1`;
        const continueDir = path_1.default.join(os_1.default.homedir(), '.continue');
        const continuePath = path_1.default.join(continueDir, 'config.json');
        try {
            if (!fs_1.default.existsSync(continueDir))
                fs_1.default.mkdirSync(continueDir, { recursive: true });
            let configJson = { models: [] };
            if (fs_1.default.existsSync(continuePath)) {
                try {
                    configJson = JSON.parse(fs_1.default.readFileSync(continuePath, 'utf-8'));
                    if (!Array.isArray(configJson.models))
                        configJson.models = [];
                }
                catch {
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
            configJson.models = configJson.models.filter((m) => !m.title?.startsWith('Antigravity'));
            configJson.models.unshift(...ogModels);
            fs_1.default.writeFileSync(continuePath, JSON.stringify(configJson, null, 2), 'utf-8');
            return {
                ide: 'Continue.dev',
                filePath: continuePath,
                success: true,
                message: `Added Antigravity models to Continue.dev configuration.`,
            };
        }
        catch (e) {
            return {
                ide: 'Continue.dev',
                filePath: continuePath,
                success: false,
                message: e.message,
            };
        }
    }
    static configureAider(workspaceDir) {
        const config = config_1.configManager.get();
        const openaiUrl = `http://${config.host}:${config.port}/v1`;
        const targetDir = workspaceDir || os_1.default.homedir();
        const aiderPath = path_1.default.join(targetDir, '.aider.conf.yml');
        try {
            const aiderYaml = `# Open Gravity configuration for Aider\nopenai-api-base: ${openaiUrl}\nopenai-api-key: gravity-bridge\nmodel: openai/gemini-3.7-flash-high\nstream: true\n`;
            fs_1.default.writeFileSync(aiderPath, aiderYaml, 'utf-8');
            return {
                ide: 'Aider',
                filePath: aiderPath,
                success: true,
                message: `Created .aider.conf.yml pointing to ${openaiUrl}`,
            };
        }
        catch (e) {
            return {
                ide: 'Aider',
                filePath: aiderPath,
                success: false,
                message: e.message,
            };
        }
    }
    static configureClaudeCode() {
        const config = config_1.configManager.get();
        const anthropicUrl = `http://${config.host}:${config.port}`;
        const home = os_1.default.homedir();
        try {
            // 1. Inject complete login bypass into ~/.claude.json
            claude_launcher_1.ClaudeLauncher.bypassLoginAndPrepareConfig();
            // 2. Create a ready-to-run wrapper batch script in user directory
            const batPath = path_1.default.join(home, 'claude-og.bat');
            const batContent = `@echo off\nset ANTHROPIC_BASE_URL=${anthropicUrl}\nset ANTHROPIC_API_KEY=sk-ant-api03-gravity-bridge-bypass-key-1234567890\nset CLAUDE_BASE_URL=${anthropicUrl}\nset DISABLE_AUTOUPDATES=1\nclaude %*\n`;
            fs_1.default.writeFileSync(batPath, batContent, 'utf-8');
            // 3. Create shortcut in project directory if exists
            const projBat = path_1.default.join(process.cwd(), 'claude-og.bat');
            fs_1.default.writeFileSync(projBat, batContent, 'utf-8');
            // 4. Also create shell script for Git Bash / WSL
            const shPath = path_1.default.join(home, 'claude-og.sh');
            const shContent = `#!/usr/bin/env bash\nexport ANTHROPIC_BASE_URL="${anthropicUrl}"\nexport ANTHROPIC_API_KEY="sk-ant-api03-gravity-bridge-bypass-key-1234567890"\nexport CLAUDE_BASE_URL="${anthropicUrl}"\nexport DISABLE_AUTOUPDATES="1"\nclaude "$@"\n`;
            fs_1.default.writeFileSync(shPath, shContent, 'utf-8');
            return {
                ide: 'Claude Code',
                filePath: batPath,
                success: true,
                message: `Injected login bypass into ~/.claude.json & created 'claude-og' launcher.`,
            };
        }
        catch (e) {
            return {
                ide: 'Claude Code',
                filePath: home,
                success: false,
                message: e.message,
            };
        }
    }
    static configureVSCode(workspaceDir) {
        const config = config_1.configManager.get();
        const openaiUrl = `http://${config.host}:${config.port}/v1`;
        let settingsPath = '';
        if (workspaceDir && fs_1.default.existsSync(workspaceDir)) {
            const vscodeDir = path_1.default.join(workspaceDir, '.vscode');
            if (!fs_1.default.existsSync(vscodeDir))
                fs_1.default.mkdirSync(vscodeDir, { recursive: true });
            settingsPath = path_1.default.join(vscodeDir, 'settings.json');
        }
        else {
            if (process.platform === 'win32') {
                const appdata = process.env.APPDATA || path_1.default.join(os_1.default.homedir(), 'AppData', 'Roaming');
                settingsPath = path_1.default.join(appdata, 'Code', 'User', 'settings.json');
            }
            else if (process.platform === 'darwin') {
                settingsPath = path_1.default.join(os_1.default.homedir(), 'Library', 'Application Support', 'Code', 'User', 'settings.json');
            }
            else {
                settingsPath = path_1.default.join(os_1.default.homedir(), '.config', 'Code', 'User', 'settings.json');
            }
        }
        try {
            const dir = path_1.default.dirname(settingsPath);
            if (!fs_1.default.existsSync(dir))
                fs_1.default.mkdirSync(dir, { recursive: true });
            let settings = {};
            if (fs_1.default.existsSync(settingsPath)) {
                try {
                    settings = JSON.parse(fs_1.default.readFileSync(settingsPath, 'utf-8'));
                }
                catch {
                    settings = {};
                }
            }
            settings['github.copilot.advanced'] = {
                debug: {
                    overrideEngine: 'gemini-3.7-flash-high',
                },
            };
            fs_1.default.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
            return {
                ide: 'VS Code',
                filePath: settingsPath,
                success: true,
                message: `Updated VS Code settings at ${settingsPath}`,
            };
        }
        catch (e) {
            return {
                ide: 'VS Code',
                filePath: settingsPath,
                success: false,
                message: e.message,
            };
        }
    }
}
exports.IdeConfigurator = IdeConfigurator;
//# sourceMappingURL=ide-config.js.map