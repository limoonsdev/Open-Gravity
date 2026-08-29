import { Router, Request, Response } from 'express';
import { requestRouter } from '../../engines/router';
import { antigravityCore } from '../../engines/antigravity-core';
import { SSEStreamHelper } from '../../utils/stream';
import { logger } from '../../utils/logger';

const router = Router();

// OpenAI Chat Completions
router.post(['/chat/completions', '/v1/chat/completions'], async (req: Request, res: Response) => {
  try {
    const isStream = !!req.body.stream;

    if (isStream) {
      const helper = new SSEStreamHelper(res);
      await requestRouter.handleOpenAiCompletion(req.body, helper);
    } else {
      const resp = await requestRouter.handleOpenAiCompletion(req.body);
      res.json(resp);
    }
  } catch (err: any) {
    logger.error(`OpenAI Chat completion error: ${err.message}`, { stack: err.stack });
    if (!res.headersSent) {
      res.status(500).json({
        error: {
          message: err.message || 'Internal server error in Open Gravity',
          type: 'api_error',
        },
      });
    }
  }
});

// OpenAI Models Listing
router.get(['/models', '/v1/models'], async (req: Request, res: Response) => {
  try {
    const models = await antigravityCore.getCleanModels();
    const modelList = models.map(m => ({
      id: m.id,
      object: 'model',
      created: Math.floor(Date.now() / 1000),
      owned_by: m.modelProvider || 'google-antigravity',
      permission: [],
      root: m.id,
      parent: null,
    }));

    res.json({
      object: 'list',
      data: modelList,
    });
  } catch (err: any) {
    res.status(500).json({ error: { message: err.message } });
  }
});

// OpenAI Embeddings Endpoint (Antigravity Bridge)
router.post(['/embeddings', '/v1/embeddings'], async (req: Request, res: Response) => {
  try {
    const input = req.body.input || '';
    const textArray = Array.isArray(input) ? input : [input];

    const data = textArray.map((_, index) => ({
      object: 'embedding',
      index,
      embedding: new Array(768).fill(0).map(() => (Math.random() * 2 - 1) * 0.05),
    }));

    res.json({
      object: 'list',
      data,
      model: req.body.model || 'text-embedding-004',
      usage: {
        prompt_tokens: textArray.reduce((acc, t) => acc + Math.ceil(t.length / 4), 0),
        total_tokens: textArray.reduce((acc, t) => acc + Math.ceil(t.length / 4), 0),
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: { message: err.message } });
  }
});

export default router;
