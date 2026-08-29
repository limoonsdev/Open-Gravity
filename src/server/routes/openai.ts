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
      await requestRouter.handleOpenAIChat(req.body, helper);
    } else {
      const resp = await requestRouter.handleOpenAIChat(req.body);
      res.json(resp);
    }
  } catch (err: any) {
    logger.error(`OpenAI Chat completion error: ${err.message}`, { stack: err.stack });
    if (!res.headersSent) {
      res.status(500).json({
        error: {
          message: err.message || 'Internal server error in Gravity Bridge',
          type: 'api_error',
        },
      });
    }
  }
});

// OpenAI Models Listing
router.get(['/models', '/v1/models'], async (req: Request, res: Response) => {
  try {
    const models = await antigravityCore.getAvailableModels();
    const modelList = Object.keys(models).length > 0 ? Object.values(models).map(m => ({
      id: m.id,
      object: 'model',
      created: 1700000000,
      owned_by: m.modelProvider || 'google-antigravity',
      permission: [],
      root: m.id,
      parent: null,
      display_name: m.displayName,
      max_tokens: m.maxTokens,
    })) : [
      { id: 'gemini-3.7-flash-high', object: 'model', created: 1700000000, owned_by: 'google-antigravity' },
      { id: 'gemini-3.7-flash-medium', object: 'model', created: 1700000000, owned_by: 'google-antigravity' },
      { id: 'gemini-3.7-flash-low', object: 'model', created: 1700000000, owned_by: 'google-antigravity' },
      { id: 'gemini-pro-agent', object: 'model', created: 1700000000, owned_by: 'google-antigravity' },
      { id: 'claude-sonnet-4-6', object: 'model', created: 1700000000, owned_by: 'google-antigravity' },
      { id: 'claude-opus-4-6-thinking', object: 'model', created: 1700000000, owned_by: 'google-antigravity' },
      { id: 'gpt-oss-120b-medium', object: 'model', created: 1700000000, owned_by: 'google-antigravity' },
    ];

    res.json({
      object: 'list',
      data: modelList,
    });
  } catch (err: any) {
    res.status(500).json({ error: { message: err.message } });
  }
});

// OpenAI Text Embeddings
router.post(['/embeddings', '/v1/embeddings'], async (req: Request, res: Response) => {
  try {
    const input = req.body.input;
    const inputs = Array.isArray(input) ? input : [input];
    
    // Return dummy embeddings vector or 768-dim embedding
    const data = inputs.map((text: string, idx: number) => ({
      object: 'embedding',
      index: idx,
      embedding: new Array(768).fill(0).map(() => (Math.random() - 0.5) * 0.1),
    }));

    res.json({
      object: 'list',
      data,
      model: req.body.model || 'text-embedding-004',
      usage: {
        prompt_tokens: inputs.reduce((acc, curr) => acc + Math.ceil(curr.length / 4), 0),
        total_tokens: inputs.reduce((acc, curr) => acc + Math.ceil(curr.length / 4), 0),
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: { message: err.message } });
  }
});

export default router;
