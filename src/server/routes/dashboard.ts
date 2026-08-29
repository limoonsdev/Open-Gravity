import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { logger, LogEntry } from '../../utils/logger';
import { requestRouter } from '../../engines/router';
import { configManager } from '../../utils/config';
import { AntigravityDiscovery } from '../../engines/discovery';
import { antigravityCore } from '../../engines/antigravity-core';

const router = Router();

function getDashboardHtml(): string {
  const htmlPath = path.join(__dirname, '..', '..', 'web', 'index.html');
  if (fs.existsSync(htmlPath)) {
    return fs.readFileSync(htmlPath, 'utf-8');
  }
  const distHtml = path.join(__dirname, '..', 'web', 'index.html');
  if (fs.existsSync(distHtml)) {
    return fs.readFileSync(distHtml, 'utf-8');
  }
  // Safe minimal inline dashboard for single-binary packaging
  return `<!DOCTYPE html>
<html>
<head>
<title>Open Gravity</title>
<style>
body { background: #080c14; color: #f1f5f9; font-family: system-ui, sans-serif; padding: 32px; }
h1 { color: #38bdf8; }
.card { background: #0f1624; border: 1px solid #1e293b; border-radius: 12px; padding: 24px; margin-top: 16px; }
pre { background: #050810; padding: 12px; border-radius: 8px; color: #a855f7; }
</style>
</head>
<body>
<h1>🪐 Open Gravity is Running</h1>
<div class="card">
<p>Proxy endpoints are active:</p>
<ul>
<li>Claude Code / Anthropic: <pre>http://127.0.0.1:8080</pre></li>
<li>OpenAI / Codex: <pre>http://127.0.0.1:8080/v1</pre></li>
</ul>
</div>
</body>
</html>`;
}

// Serve the dashboard HTML
router.get(['/', '/dashboard'], (req: Request, res: Response) => {
  const html = getDashboardHtml();
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

// SSE Stream of live logs
router.get('/api/dashboard/logs/stream', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const recent = logger.getRecentLogs();
  for (const r of recent) {
    res.write(`data: ${JSON.stringify(r)}\n\n`);
  }

  const onLog = (log: LogEntry) => {
    res.write(`data: ${JSON.stringify(log)}\n\n`);
  };

  logger.on('log', onLog);

  req.on('close', () => {
    logger.removeListener('log', onLog);
  });
});

// Dashboard stats endpoint
router.get('/api/dashboard/stats', async (req: Request, res: Response) => {
  const instance = await AntigravityDiscovery.discover();
  const stats = requestRouter.getStats();
  const config = configManager.get();
  const account = await antigravityCore.getUserAccountDetails();

  res.json({
    stats,
    account,
    config: {
      port: config.port,
      host: config.host,
      defaultModel: config.defaultModel,
      hasGeminiKey: !!config.geminiApiKey,
    },
    antigravity: instance ? {
      connected: true,
      pid: instance.pid,
      port: instance.port,
      ports: instance.ports,
    } : { connected: false },
  });
});

// Update configuration
router.post('/api/dashboard/config', (req: Request, res: Response) => {
  const updated = configManager.update(req.body);
  res.json({ success: true, config: updated });
});

export default router;
