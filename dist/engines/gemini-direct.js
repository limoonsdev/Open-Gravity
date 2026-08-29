"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.geminiDirectEngine = exports.GeminiDirectEngine = void 0;
const https_1 = __importDefault(require("https"));
class GeminiDirectEngine {
    static instance = null;
    static getInstance() {
        if (!this.instance) {
            this.instance = new GeminiDirectEngine();
        }
        return this.instance;
    }
    async generateContent(params) {
        const model = this.normalizeModel(params.model);
        const path = `/v1beta/models/${model}:generateContent?key=${params.apiKey}`;
        return this.makeRequest(path, params.body);
    }
    async streamGenerateContent(params) {
        const model = this.normalizeModel(params.model);
        const path = `/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${params.apiKey}`;
        return new Promise((resolve, reject) => {
            const payload = JSON.stringify(params.body);
            const req = https_1.default.request({
                hostname: 'generativelanguage.googleapis.com',
                port: 443,
                path,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(payload),
                },
                timeout: 90000,
            }, (res) => {
                if (res.statusCode && res.statusCode >= 400) {
                    let errBody = '';
                    res.on('data', c => errBody += c);
                    res.on('end', () => {
                        const err = new Error(`Gemini API Error (${res.statusCode}): ${errBody}`);
                        params.onError?.(err);
                        reject(err);
                    });
                    return;
                }
                let buffer = '';
                res.on('data', (chunk) => {
                    buffer += chunk.toString('utf-8');
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';
                    for (const line of lines) {
                        const trimmed = line.trim();
                        if (trimmed.startsWith('data: ')) {
                            const jsonStr = trimmed.substring(6).trim();
                            if (jsonStr) {
                                try {
                                    const data = JSON.parse(jsonStr);
                                    params.onChunk(data);
                                }
                                catch {
                                    // ignore partial json
                                }
                            }
                        }
                    }
                });
                res.on('end', () => {
                    if (buffer.trim().startsWith('data: ')) {
                        try {
                            const data = JSON.parse(buffer.trim().substring(6).trim());
                            params.onChunk(data);
                        }
                        catch {
                            // ignore
                        }
                    }
                    resolve();
                });
            });
            req.on('error', (err) => {
                params.onError?.(err);
                reject(err);
            });
            req.write(payload);
            req.end();
        });
    }
    normalizeModel(rawModel) {
        let m = rawModel.replace(/^models\//, '');
        if (m.startsWith('gemini-3.7-flash'))
            return 'gemini-2.5-flash';
        if (m.startsWith('gemini-pro') || m.startsWith('gemini-3.1-pro'))
            return 'gemini-2.5-pro';
        if (m.startsWith('claude'))
            return 'gemini-2.5-pro';
        if (m.includes('flash'))
            return 'gemini-2.5-flash';
        if (m.includes('pro'))
            return 'gemini-2.5-pro';
        return m || 'gemini-2.5-flash';
    }
    makeRequest(path, body) {
        return new Promise((resolve, reject) => {
            const payload = JSON.stringify(body);
            const req = https_1.default.request({
                hostname: 'generativelanguage.googleapis.com',
                port: 443,
                path,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(payload),
                },
                timeout: 60000,
            }, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                        try {
                            resolve(JSON.parse(data));
                        }
                        catch {
                            resolve(data);
                        }
                    }
                    else {
                        reject(new Error(`Gemini request failed (${res.statusCode}): ${data}`));
                    }
                });
            });
            req.on('error', err => reject(err));
            req.write(payload);
            req.end();
        });
    }
}
exports.GeminiDirectEngine = GeminiDirectEngine;
exports.geminiDirectEngine = GeminiDirectEngine.getInstance();
//# sourceMappingURL=gemini-direct.js.map