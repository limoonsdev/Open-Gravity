import { Router, Request, Response } from 'express';
import { requestRouter } from '../../engines/router';
import { SSEStreamHelper } from '../../utils/stream';
import { logger } from '../../utils/logger';

const router = Router();

// Anthropic Messages API (Claude Code CLI / Cursor / Aider)
router.post(['/messages', '/v1/messages'], async (req: Request, res: Response) => {
  try {
    const isStream = !!req.body.stream;

    if (isStream) {
      const helper = new SSEStreamHelper(res);
      await requestRouter.handleAnthropicMessages(req.body, helper);
    } else {
      const resp = await requestRouter.handleAnthropicMessages(req.body);
      res.json(resp);
    }
  } catch (err: any) {
    logger.error(`Anthropic Messages error: ${err.message}`, { stack: err.stack });
    if (!res.headersSent) {
      res.status(500).json({
        type: 'error',
        error: {
          type: 'api_error',
          message: err.message || 'Internal server error in Gravity Bridge',
        },
      });
    }
  }
});

// Legacy Anthropic Complete API
router.post(['/complete', '/v1/complete'], async (req: Request, res: Response) => {
  try {
    const prompt = req.body.prompt || '';
    const messages = [{ role: 'user', content: prompt }];
    const resp = await requestRouter.handleAnthropicMessages({
      model: req.body.model,
      messages,
      max_tokens: req.body.max_tokens_to_sample || 4096,
    });

    const text = resp?.content?.[0]?.text || '';
    res.json({
      completion: text,
      stop_reason: 'stop_sequence',
      model: req.body.model,
    });
  } catch (err: any) {
    res.status(500).json({ type: 'error', error: { message: err.message } });
  }
});

export default router;
