"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.configManager = exports.ConfigManager = exports.DEFAULT_CONFIG = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const CONFIG_FILE = path_1.default.join(os_1.default.homedir(), '.gemini', 'gravity-bridge.json');
exports.DEFAULT_CONFIG = {
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
class ConfigManager {
    config;
    constructor() {
        this.config = this.loadConfig();
    }
    get() {
        return { ...this.config };
    }
    update(partial) {
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
    resolveModel(requestedModel) {
        if (!requestedModel)
            return this.config.defaultModel;
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
    loadConfig() {
        try {
            if (fs_1.default.existsSync(CONFIG_FILE)) {
                const raw = fs_1.default.readFileSync(CONFIG_FILE, 'utf-8');
                const parsed = JSON.parse(raw);
                return {
                    ...exports.DEFAULT_CONFIG,
                    ...parsed,
                    modelAliases: {
                        ...exports.DEFAULT_CONFIG.modelAliases,
                        ...(parsed.modelAliases || {})
                    }
                };
            }
        }
        catch (e) {
            // ignore
        }
        return { ...exports.DEFAULT_CONFIG };
    }
    saveConfig() {
        try {
            const dir = path_1.default.dirname(CONFIG_FILE);
            if (!fs_1.default.existsSync(dir)) {
                fs_1.default.mkdirSync(dir, { recursive: true });
            }
            fs_1.default.writeFileSync(CONFIG_FILE, JSON.stringify(this.config, null, 2), 'utf-8');
        }
        catch (e) {
            // ignore
        }
    }
}
exports.ConfigManager = ConfigManager;
exports.configManager = new ConfigManager();
//# sourceMappingURL=config.js.map