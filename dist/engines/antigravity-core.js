"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.antigravityCore = exports.AntigravityCore = void 0;
const https_1 = __importDefault(require("https"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const child_process_1 = require("child_process");
const util_1 = __importDefault(require("util"));
const discovery_1 = require("./discovery");
const logger_1 = require("../utils/logger");
const execAsync = util_1.default.promisify(child_process_1.exec);
class AntigravityCore {
    static instance = null;
    agentApiExePath = '';
    constructor() {
        this.findAgentApiExe();
    }
    static getInstance() {
        if (!this.instance) {
            this.instance = new AntigravityCore();
        }
        return this.instance;
    }
    findAgentApiExe() {
        if (process.env.ANTIGRAVITY_AGENTAPI_EXE && fs_1.default.existsSync(process.env.ANTIGRAVITY_AGENTAPI_EXE)) {
            this.agentApiExePath = process.env.ANTIGRAVITY_AGENTAPI_EXE;
            return;
        }
        const home = os_1.default.homedir();
        const candidatePaths = [
            path_1.default.join(home, 'AppData', 'Local', 'Programs', 'antigravity', 'resources', 'bin', 'language_server.exe'),
            path_1.default.join(home, '.gemini', 'antigravity', 'bin', 'agentapi.bat'),
            '/Applications/Antigravity.app/Contents/Resources/bin/language_server',
            '/opt/antigravity/resources/bin/language_server'
        ];
        for (const p of candidatePaths) {
            if (fs_1.default.existsSync(p)) {
                this.agentApiExePath = p;
                break;
            }
        }
    }
    async rpcCall(method, body = {}) {
        const inst = await discovery_1.AntigravityDiscovery.discover();
        if (!inst) {
            throw new Error('Google Antigravity Language Server is not running or not detected.');
        }
        const endpoint = `/exa.language_server_pb.LanguageServerService/${method}`;
        return new Promise((resolve, reject) => {
            const agent = new https_1.default.Agent({ rejectUnauthorized: false });
            const payload = JSON.stringify(body);
            const req = https_1.default.request({
                hostname: '127.0.0.1',
                port: inst.port,
                path: endpoint,
                method: 'POST',
                agent,
                headers: {
                    'x-codeium-csrf-token': inst.csrfToken,
                    'Content-Type': 'application/json',
                    'Connect-Protocol-Version': '1',
                    'Content-Length': Buffer.byteLength(payload),
                },
                timeout: 10000,
            }, (res) => {
                let raw = '';
                res.on('data', chunk => raw += chunk);
                res.on('end', () => {
                    if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                        try {
                            resolve(raw ? JSON.parse(raw) : {});
                        }
                        catch {
                            resolve(raw);
                        }
                    }
                    else {
                        reject(new Error(`Antigravity RPC ${method} failed with status ${res.statusCode}: ${raw}`));
                    }
                });
            });
            req.on('error', err => reject(err));
            req.on('timeout', () => {
                req.destroy();
                reject(new Error(`Antigravity RPC ${method} timed out`));
            });
            req.write(payload);
            req.end();
        });
    }
    async getCleanModels() {
        try {
            const status = await this.getUserStatus();
            const rawConfigs = status?.cascadeModelConfigData?.clientModelConfigs || [];
            const cleanList = [];
            for (const mc of rawConfigs) {
                const id = mc.modelId;
                if (!id || id.startsWith('chat_') || id.startsWith('embedding_') || id.startsWith('code_')) {
                    continue;
                }
                let provider = 'Google';
                if (id.includes('claude'))
                    provider = 'Anthropic';
                else if (id.includes('gpt'))
                    provider = 'OpenAI/OSS';
                const quotaPct = mc.quotaInfo?.remainingFraction !== undefined
                    ? Math.round(mc.quotaInfo.remainingFraction * 100)
                    : undefined;
                cleanList.push({
                    id,
                    displayName: mc.label || id,
                    model: mc.modelOrAlias?.model || id,
                    maxTokens: id.includes('gemini') ? 1048576 : (id.includes('claude') ? 250000 : 131072),
                    supportsThinking: id.includes('thinking') || id.includes('high'),
                    apiProvider: provider,
                    modelProvider: provider,
                    quotaRemainingPercent: quotaPct,
                    quotaResetTime: mc.quotaInfo?.resetTime,
                    isRecommended: !!mc.isRecommended,
                    status: 'untested',
                });
            }
            if (cleanList.length > 0) {
                // Sort with recommended models on top
                return cleanList.sort((a, b) => {
                    if (a.id === 'gemini-3.7-flash-high')
                        return -1;
                    if (b.id === 'gemini-3.7-flash-high')
                        return 1;
                    return (b.quotaRemainingPercent || 0) - (a.quotaRemainingPercent || 0);
                });
            }
        }
        catch (e) {
            logger_1.logger.debug(`Failed to fetch clean models: ${e.message}`);
        }
        // Fallback list of genuine models
        return [
            { id: 'gemini-3.7-flash-high', displayName: 'Gemini 3.7 Flash (High)', model: 'gemini-3.7-flash-high', maxTokens: 1048576, modelProvider: 'Google', supportsThinking: true, isRecommended: true, quotaRemainingPercent: 100 },
            { id: 'gemini-3.7-flash-medium', displayName: 'Gemini 3.7 Flash (Medium)', model: 'gemini-3.7-flash-medium', maxTokens: 1048576, modelProvider: 'Google', quotaRemainingPercent: 100 },
            { id: 'gemini-3.7-flash-low', displayName: 'Gemini 3.7 Flash (Low)', model: 'gemini-3.7-flash-low', maxTokens: 1048576, modelProvider: 'Google', quotaRemainingPercent: 100 },
            { id: 'gemini-pro-agent', displayName: 'Gemini 3.1 Pro (High)', model: 'gemini-pro-agent', maxTokens: 1048576, modelProvider: 'Google', supportsThinking: true, quotaRemainingPercent: 100 },
            { id: 'claude-sonnet-4-6', displayName: 'Claude Sonnet 4.6 (Thinking)', model: 'claude-sonnet-4-6', maxTokens: 250000, modelProvider: 'Anthropic', supportsThinking: true, quotaRemainingPercent: 100 },
            { id: 'claude-opus-4-6-thinking', displayName: 'Claude Opus 4.6 (Thinking)', model: 'claude-opus-4-6-thinking', maxTokens: 250000, modelProvider: 'Anthropic', supportsThinking: true, quotaRemainingPercent: 100 },
            { id: 'gpt-oss-120b-medium', displayName: 'GPT-OSS 120B (Medium)', model: 'gpt-oss-120b-medium', maxTokens: 131072, modelProvider: 'OpenAI/OSS', quotaRemainingPercent: 100 },
        ];
    }
    async getAvailableModels() {
        const clean = await this.getCleanModels();
        const map = {};
        for (const m of clean) {
            map[m.id] = m;
        }
        return map;
    }
    async pingModel(modelId) {
        const start = Date.now();
        try {
            // Fast 1-token probe
            const tier = modelId.includes('pro') ? 'pro' : (modelId.includes('low') ? 'flash_lite' : 'flash');
            // Quick test via agentapi with 1 token prompt
            const result = await Promise.race([
                this.generateViaAgentApi({ prompt: '1', modelTier: tier }),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Probe timeout (4s)')), 4000))
            ]);
            const latencyMs = Date.now() - start;
            return { success: true, latencyMs };
        }
        catch (e) {
            const latencyMs = Date.now() - start;
            return { success: false, latencyMs, error: e.message };
        }
    }
    async getUserStatus() {
        try {
            const resp = await this.rpcCall('GetUserStatus', {});
            return resp?.userStatus || null;
        }
        catch {
            return null;
        }
    }
    async getUserAccountDetails() {
        try {
            const status = await this.getUserStatus();
            if (!status)
                return null;
            const name = status.name || 'Google User';
            const email = status.email || 'Active session';
            const planName = status.userTier?.name || status.planStatus?.planInfo?.planName || 'Google AI Pro';
            const tierDescription = status.userTier?.description || 'Active subscription';
            let remainingPercent = 100;
            let resetTime;
            const modelConfigs = status.cascadeModelConfigData?.clientModelConfigs || [];
            for (const mc of modelConfigs) {
                if (mc.quotaInfo?.remainingFraction !== undefined) {
                    const pct = Math.round(mc.quotaInfo.remainingFraction * 100);
                    if (pct < remainingPercent) {
                        remainingPercent = pct;
                        resetTime = mc.quotaInfo.resetTime;
                    }
                }
            }
            return {
                name,
                email,
                planName,
                tierDescription,
                quotaRemainingPercent: remainingPercent,
                quotaResetTime: resetTime,
            };
        }
        catch {
            return null;
        }
    }
    async generateViaAgentApi(params) {
        const tier = params.modelTier || 'flash';
        const escapedPrompt = params.prompt.replace(/"/g, '\\"').replace(/\n/g, ' ');
        let cmd;
        if (this.agentApiExePath.endsWith('.bat')) {
            cmd = `"${this.agentApiExePath}" new-conversation --model=${tier} "${escapedPrompt}"`;
        }
        else if (this.agentApiExePath.endsWith('.exe')) {
            cmd = `"${this.agentApiExePath}" agentapi new-conversation --model=${tier} "${escapedPrompt}"`;
        }
        else {
            cmd = `agentapi new-conversation --model=${tier} "${escapedPrompt}"`;
        }
        logger_1.logger.debug(`Executing agentapi: ${cmd}`);
        const { stdout, stderr } = await execAsync(cmd);
        let conversationId = null;
        try {
            const parsed = JSON.parse(stdout);
            conversationId = parsed?.response?.newConversation?.conversationId;
        }
        catch {
            const match = stdout.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
            if (match)
                conversationId = match[1];
        }
        if (!conversationId) {
            throw new Error(`Failed to create conversation with Antigravity: ${stdout || stderr}`);
        }
        const home = os_1.default.homedir();
        const transcriptPath = path_1.default.join(home, '.gemini', 'antigravity', 'brain', conversationId, '.system_generated', 'logs', 'transcript.jsonl');
        return await this.pollTranscript(transcriptPath, params.onDelta);
    }
    async pollTranscript(transcriptPath, onDelta) {
        const maxWaitMs = 60000;
        const intervalMs = 300;
        let elapsed = 0;
        let lastLength = 0;
        let accumulatedResponse = '';
        while (elapsed < maxWaitMs) {
            await new Promise(r => setTimeout(r, intervalMs));
            elapsed += intervalMs;
            if (!fs_1.default.existsSync(transcriptPath))
                continue;
            try {
                const content = fs_1.default.readFileSync(transcriptPath, 'utf-8');
                const lines = content.trim().split('\n');
                for (const line of lines) {
                    if (!line.trim())
                        continue;
                    try {
                        const step = JSON.parse(line);
                        if (step.source === 'MODEL' && (step.type === 'PLANNER_RESPONSE' || step.type === 'MODEL_OUTPUT')) {
                            const fullText = step.content || '';
                            if (fullText.length > lastLength) {
                                const delta = fullText.slice(lastLength);
                                lastLength = fullText.length;
                                accumulatedResponse = fullText;
                                if (onDelta) {
                                    onDelta(delta);
                                }
                            }
                            if (step.status === 'DONE') {
                                return accumulatedResponse || fullText;
                            }
                        }
                    }
                    catch {
                        // line might be partially written
                    }
                }
            }
            catch {
                // file locked momentarily
            }
        }
        if (accumulatedResponse)
            return accumulatedResponse;
        throw new Error('Antigravity model response timed out after 60s');
    }
}
exports.AntigravityCore = AntigravityCore;
exports.antigravityCore = AntigravityCore.getInstance();
//# sourceMappingURL=antigravity-core.js.map