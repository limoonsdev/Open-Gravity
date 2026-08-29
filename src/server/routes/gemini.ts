import { Router, Request, Response } from 'express';
import { geminiDirectEngine } from '../../engines/gemini-direct';
import { configManager } from '../../utils/config';
import { logger } from '../../utils/logger';

const router = Router();

// Gemini GenerateContent
router.post('/v1beta/models/:modelAndMethod', async (req: Request, res: Response) => {
  try {
    const raw = req.params.modelAndMethod;
    const isStream = raw.includes(':streamGenerateContent');
    const model = raw.replace(/:(generateContent|streamGenerateContent)$/, '');

    const config = configManager.get();
    const apiKey = (req.query.key as string) || config.geminiApiKey;

    if (!apiKey) {
      return res.status(400).json({
        error: { message: 'Missing Gemini API key in query params (?key=...) or config' },
      });
    }

    if (isStream) {
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      await geminiDirectEngine.streamGenerateContent({
        apiKey,
        model,
        body: req.body,
        onChunk: (chunk) => {
          res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        },
      });
      res.end();
    } else {
      const resp = await geminiDirectEngine.generateContent({
        apiKey,
        model,
        body: req.body,
      });
      res.json(resp);
    }
  } catch (err: any) {
    logger.error(`Gemini route error: ${err.message}`);
    if (!res.headersSent) {
      res.status(500).json({ error: { message: err.message } });
    }
  }
});

export default router;
