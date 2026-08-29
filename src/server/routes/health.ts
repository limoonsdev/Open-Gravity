import { Router, Request, Response } from 'express';
import { AntigravityDiscovery } from '../../engines/discovery';
import { requestRouter } from '../../engines/router';
import { configManager } from '../../utils/config';

const router = Router();

router.get(['/health', '/healthz'], (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'Gravity Bridge',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

router.get('/status', async (req: Request, res: Response) => {
  const instance = await AntigravityDiscovery.discover(true);
  const stats = requestRouter.getStats();
  const config = configManager.get();

  res.json({
    bridge: {
      status: 'active',
      host: config.host,
      port: config.port,
      defaultModel: config.defaultModel,
      hasGeminiApiKey: !!config.geminiApiKey,
    },
    antigravity: instance ? {
      connected: true,
      pid: instance.pid,
      activePort: instance.port,
      ports: instance.ports,
      csrfTokenConfigured: !!instance.csrfToken,
    } : {
      connected: false,
      message: 'Antigravity Language Server not detected or closed.',
    },
    stats,
  });
});

export default router;
