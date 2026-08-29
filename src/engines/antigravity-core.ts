import https from 'https';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { exec } from 'child_process';
import util from 'util';
import { AntigravityDiscovery, AntigravityInstance } from './discovery';
import { logger } from '../utils/logger';

const execAsync = util.promisify(exec);

export interface AntigravityModelInfo {
  id: string;
  displayName: string;
  model: string;
  maxTokens: number;
  maxOutputTokens?: number;
  supportsThinking?: boolean;
  thinkingBudget?: number;
  apiProvider?: string;
  modelProvider?: string;
  quotaRemainingPercent?: number;
  quotaResetTime?: string;
  isRecommended?: boolean;
  status?: 'online' | 'offline' | 'untested' | 'quota_exceeded';
  latencyMs?: number;
}

export interface UserAccountDetails {
  name: string;
  email: string;
  planName: string;
  tierDescription: string;
  quotaRemainingPercent: number;
  quotaResetTime?: string;
}

export class AntigravityCore {
  private static instance: AntigravityCore | null = null;
  private agentApiExePath: string = '';

  private constructor() {
    this.findAgentApiExe();
  }

  public static getInstance(): AntigravityCore {
    if (!this.instance) {
      this.instance = new AntigravityCore();
    }
    return this.instance;
  }

  private findAgentApiExe() {
    if (process.env.ANTIGRAVITY_AGENTAPI_EXE && fs.existsSync(process.env.ANTIGRAVITY_AGENTAPI_EXE)) {
      this.agentApiExePath = process.env.ANTIGRAVITY_AGENTAPI_EXE;
      return;
    }

    const home = os.homedir();
    const candidatePaths = [
      path.join(home, 'AppData', 'Local', 'Programs', 'antigravity', 'resources', 'bin', 'language_server.exe'),
      path.join(home, '.gemini', 'antigravity', 'bin', 'agentapi.bat'),
      '/Applications/Antigravity.app/Contents/Resources/bin/language_server',
      '/opt/antigravity/resources/bin/language_server'
    ];

    for (const p of candidatePaths) {
      if (fs.existsSync(p)) {
        this.agentApiExePath = p;
        break;
      }
    }
  }

  public async rpcCall<T = any>(method: string, body: any = {}): Promise<T> {
    const inst = await AntigravityDiscovery.discover();
    if (!inst) {
      throw new Error('Google Antigravity Language Server is not running or not detected.');
    }

    const endpoint = `/exa.language_server_pb.LanguageServerService/${method}`;
    return new Promise((resolve, reject) => {
      const agent = new https.Agent({ rejectUnauthorized: false });
      const payload = JSON.stringify(body);
      const req = https.request({
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
              resolve(raw ? JSON.parse(raw) : {} as any);
            } catch {
              resolve(raw as any);
            }
          } else {
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

  public async getCleanModels(): Promise<AntigravityModelInfo[]> {
    try {
      const status = await this.getUserStatus();
      const rawConfigs = status?.cascadeModelConfigData?.clientModelConfigs || [];
      const cleanList: AntigravityModelInfo[] = [];

      for (const mc of rawConfigs) {
        const id = mc.modelId;
        if (!id || id.startsWith('chat_') || id.startsWith('embedding_') || id.startsWith('code_')) {
          continue;
        }

        let provider = 'Google';
        if (id.includes('claude')) provider = 'Anthropic';
        else if (id.includes('gpt')) provider = 'OpenAI/OSS';

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
          if (a.id === 'gemini-3.7-flash-high') return -1;
          if (b.id === 'gemini-3.7-flash-high') return 1;
          return (b.quotaRemainingPercent || 0) - (a.quotaRemainingPercent || 0);
        });
      }
    } catch (e: any) {
      logger.debug(`Failed to fetch clean models: ${e.message}`);
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

  public async getAvailableModels(): Promise<Record<string, AntigravityModelInfo>> {
    const clean = await this.getCleanModels();
    const map: Record<string, AntigravityModelInfo> = {};
    for (const m of clean) {
      map[m.id] = m;
    }
    return map;
  }

  public async pingModel(modelId: string): Promise<{ success: boolean; latencyMs: number; error?: string }> {
    const start = Date.now();
    try {
      // Fast 1-token probe
      const tier = modelId.includes('pro') ? 'pro' : (modelId.includes('low') ? 'flash_lite' : 'flash');
      
      // Quick test via agentapi with 1 token prompt
      const result = await Promise.race([
        this.generateViaAgentApi({ prompt: '1', modelTier: tier }),
        new Promise<string>((_, reject) => setTimeout(() => reject(new Error('Probe timeout (4s)')), 4000))
      ]);

      const latencyMs = Date.now() - start;
      return { success: true, latencyMs };
    } catch (e: any) {
      const latencyMs = Date.now() - start;
      return { success: false, latencyMs, error: e.message };
    }
  }

  public async getUserStatus(): Promise<any> {
    try {
      const resp = await this.rpcCall('GetUserStatus', {});
      return resp?.userStatus || null;
    } catch {
      return null;
    }
  }

  public async getUserAccountDetails(): Promise<UserAccountDetails | null> {
    try {
      const status = await this.getUserStatus();
      if (!status) return null;

      const name = status.name || 'Google User';
      const email = status.email || 'Active session';
      const planName = status.userTier?.name || status.planStatus?.planInfo?.planName || 'Google AI Pro';
      const tierDescription = status.userTier?.description || 'Active subscription';

      let remainingPercent = 100;
      let resetTime: string | undefined;

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
    } catch {
      return null;
    }
  }

  public async generateViaAgentApi(params: {
    prompt: string;
    modelTier?: 'flash_lite' | 'flash' | 'pro';
    title?: string;
    onDelta?: (chunk: string) => void;
  }): Promise<string> {
    const tier = params.modelTier || 'flash';
    const escapedPrompt = params.prompt.replace(/"/g, '\\"').replace(/\n/g, ' ');

    let cmd: string;
    if (this.agentApiExePath.endsWith('.bat')) {
      cmd = `"${this.agentApiExePath}" new-conversation --model=${tier} "${escapedPrompt}"`;
    } else if (this.agentApiExePath.endsWith('.exe')) {
      cmd = `"${this.agentApiExePath}" agentapi new-conversation --model=${tier} "${escapedPrompt}"`;
    } else {
      cmd = `agentapi new-conversation --model=${tier} "${escapedPrompt}"`;
    }

    logger.debug(`Executing agentapi: ${cmd}`);
    const { stdout, stderr } = await execAsync(cmd);
    
    let conversationId: string | null = null;
    try {
      const parsed = JSON.parse(stdout);
      conversationId = parsed?.response?.newConversation?.conversationId;
    } catch {
      const match = stdout.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
      if (match) conversationId = match[1];
    }

    if (!conversationId) {
      throw new Error(`Failed to create conversation with Antigravity: ${stdout || stderr}`);
    }

    const home = os.homedir();
    const transcriptPath = path.join(home, '.gemini', 'antigravity', 'brain', conversationId, '.system_generated', 'logs', 'transcript.jsonl');
    
    return await this.pollTranscript(transcriptPath, params.onDelta);
  }

  private async pollTranscript(transcriptPath: string, onDelta?: (chunk: string) => void): Promise<string> {
    const maxWaitMs = 60000;
    const intervalMs = 300;
    let elapsed = 0;
    let lastLength = 0;
    let accumulatedResponse = '';

    while (elapsed < maxWaitMs) {
      await new Promise(r => setTimeout(r, intervalMs));
      elapsed += intervalMs;

      if (!fs.existsSync(transcriptPath)) continue;

      try {
        const content = fs.readFileSync(transcriptPath, 'utf-8');
        const lines = content.trim().split('\n');
        
        for (const line of lines) {
          if (!line.trim()) continue;
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
          } catch {
            // line might be partially written
          }
        }
      } catch {
        // file locked momentarily
      }
    }

    if (accumulatedResponse) return accumulatedResponse;
    throw new Error('Antigravity model response timed out after 60s');
  }
}

export const antigravityCore = AntigravityCore.getInstance();
