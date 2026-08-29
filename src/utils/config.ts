import fs from 'fs';
import path from 'path';
import os from 'os';
import dotenv from 'dotenv';

dotenv.config();

export interface BridgeConfig {
  port: number;
  host: string;
  apiKey: string;
  defaultModel: string;
  preferAntigravity: boolean;
  geminiApiKey?: string;
  verbose: boolean;
  openBrowserOnStart: boolean;
  modelAliases: Record<string, string>;
}

const CONFIG_FILE = path.join(os.homedir(), '.gemini', 'gravity-bridge.json');

export const DEFAULT_CONFIG: BridgeConfig = {
  port: parseInt(process.env.GRAVITY_BRIDGE_PORT || '8080', 10),
  host: process.env.GRAVITY_BRIDGE_HOST || '127.0.0.1',
  apiKey: process.env.GRAVITY_BRIDGE_API_KEY || 'gravity-bridge',
  defaultModel: process.env.GRAVITY_BRIDGE_DEFAULT_MODEL || 'gemini-3.7-flash-high',
  preferAntigravity: true,
  geminiApiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY,
  verbose: false,
  openBrowserOnStart: false,
  modelAliases: {
    // Anthropic / Claude Code aliases
    'claude-3-7-sonnet': 'claude-sonnet-4-6',
    'claude-3-7-sonnet-20250219': 'claude-sonnet-4-6',
    'claude-3-5-sonnet': 'claude-sonnet-4-6',
    'claude-3-5-sonnet-20241022': 'claude-sonnet-4-6',
    'claude-3-5-sonnet-20240620': 'claude-sonnet-4-6',
    'claude-3-5-haiku': 'gemini-3.7-flash-low',
    'claude-3-opus': 'claude-opus-4-6-thinking',
    'claude-opus-4-6-thinking': 'claude-opus-4-6-thinking',
    'claude-sonnet-4-6': 'claude-sonnet-4-6',

    // OpenAI / Codex aliases
    'gpt-4o': 'gemini-3.7-flash-high',
    'gpt-4o-mini': 'gemini-3.7-flash-low',
    'gpt-4-turbo': 'gemini-3.7-flash-high',
    'gpt-4': 'gemini-pro-agent',
    'gpt-3.5-turbo': 'gemini-3.7-flash-low',
    'o1': 'gemini-3.7-flash-high',
    'o3-mini': 'gemini-3.7-flash-high',
    'codex': 'gemini-3.7-flash-high',
    'gpt-oss': 'gpt-oss-120b-medium',
    'gpt-oss-120b-medium': 'gpt-oss-120b-medium',

    // Gemini standard aliases
    'gemini-2.5-pro': 'gemini-pro-agent',
    'gemini-2.5-flash': 'gemini-3.7-flash-low',
    'gemini-3-flash': 'gemini-3-flash-agent',
    'gemini-3.0-pro': 'gemini-pro-agent',
    'gemini-3.7-flash': 'gemini-3.7-flash-high',
    'gemini-3.7-flash-high': 'gemini-3.7-flash-high',
    'gemini-3.7-flash-medium': 'gemini-3.7-flash-medium',
    'gemini-3.7-flash-low': 'gemini-3.7-flash-low',
    'gemini-pro-agent': 'gemini-pro-agent',
    'gemini-3.1-pro-low': 'gemini-3.1-pro-low',
  }
};

export class ConfigManager {
  private config: BridgeConfig;

  constructor() {
    this.config = this.loadConfig();
  }

  public get(): BridgeConfig {
    return { ...this.config };
  }

  public update(partial: Partial<BridgeConfig>): BridgeConfig {
    this.config = {
      ...this.config,
      ...partial,
      modelAliases: {
        ...this.config.modelAliases,
        ...(partial.modelAliases || {})
      }
    };
    this.saveConfig();
    return this.get();
  }

  public resolveModel(requestedModel?: string): string {
    if (!requestedModel) return this.config.defaultModel;
    const clean = requestedModel.trim().toLowerCase();
    
    // Check direct alias
    if (this.config.modelAliases[clean]) {
      return this.config.modelAliases[clean];
    }

    // Check with prefixes stripped (e.g. openai/gpt-4o or anthropic/claude-3-7-sonnet)
    const stripped = clean.replace(/^(openai|anthropic|google|gemini)\//, '');
    if (this.config.modelAliases[stripped]) {
      return this.config.modelAliases[stripped];
    }

    return requestedModel;
  }

  private loadConfig(): BridgeConfig {
    try {
      if (fs.existsSync(CONFIG_FILE)) {
        const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        return {
          ...DEFAULT_CONFIG,
          ...parsed,
          modelAliases: {
            ...DEFAULT_CONFIG.modelAliases,
            ...(parsed.modelAliases || {})
          }
        };
      }
    } catch (e) {
      // ignore
    }
    return { ...DEFAULT_CONFIG };
  }

  private saveConfig(): void {
    try {
      const dir = path.dirname(CONFIG_FILE);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(this.config, null, 2), 'utf-8');
    } catch (e) {
      // ignore
    }
  }
}

export const configManager = new ConfigManager();
