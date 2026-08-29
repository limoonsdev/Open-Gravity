import { Request, Response, NextFunction } from 'express';
import chalk from 'chalk';
import { logger } from '../../utils/logger';

export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();
  const method = req.method;
  const url = req.originalUrl || req.url;

  // Filter out noisy polling from dashboard
  const isPolling = url.includes('/api/dashboard/stats') || url.includes('/status') || url.includes('/api/dashboard/logs');

  res.on('finish', () => {
    const duration = Date.now() - start;
    const status = res.statusCode;
    const isError = status >= 400;

    let modelTag = '';
    if (req.body?.model) {
      modelTag = chalk.gray(` (${req.body.model})`);
    }

    let statusColor = chalk.green;
    if (status >= 500) statusColor = chalk.red;
    else if (status >= 400) statusColor = chalk.yellow;

    const formattedLog = `${statusColor(String(status))} ${chalk.bold(method)} ${url}${modelTag} ${chalk.gray(`${duration}ms`)}`;

    if (!isPolling) {
      if (isError) {
        logger.warn(formattedLog);
      } else {
        logger.request(formattedLog);
      }
    }
  });

  next();
}
