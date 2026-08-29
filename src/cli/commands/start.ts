import http from 'http';
import open from 'open';
import chalk from 'chalk';
import net from 'net';
import readline from 'readline';
import { createBridgeApp } from '../../server/app';
import { configManager } from '../../utils/config';
import { AntigravityDiscovery } from '../../engines/discovery';
import { antigravityCore } from '../../engines/antigravity-core';
import { printBanner } from '../banner';
import { logger } from '../../utils/logger';

async function isPortAvailable(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const tester = net.createServer()
      .once('error', () => resolve(false))
      .once('listening', () => {
        tester.once('close', () => resolve(true)).close();
      })
      .listen(port, host);
  });
}

async function findAvailablePort(startPort: number, host: string): Promise<number> {
  let p = startPort;
  for (let i = 0; i < 20; i++) {
    if (await isPortAvailable(p, host)) {
      return p;
    }
    p++;
  }
  return startPort;
}

export async function startCommand(options: {
  port?: number;
  host?: string;
  open?: boolean;
  model?: string;
}) {
  const config = configManager.get();
  const host = options.host || config.host;
  let targetPort = options.port || config.port;

  if (options.model) {
    configManager.update({ defaultModel: options.model });
  }

  logger.info('Starting Open Gravity...');

  // Auto-discover Antigravity
  const instance = await AntigravityDiscovery.discover(true);
  let accountDetails = null;

  if (instance) {
    logger.success(`Antigravity Language Server detected (PID: ${instance.pid}, Port: ${instance.port})`);
    accountDetails = await antigravityCore.getUserAccountDetails();
  } else {
    logger.warn('Antigravity Language Server not detected. Make sure Antigravity is running to use your Pro subscription.');
  }

  // Check port availability and auto-fallback if needed
  const availablePort = await findAvailablePort(targetPort, host);
  if (availablePort !== targetPort) {
    logger.info(`Port ${targetPort} is occupied, automatically bound to available port ${availablePort}`);
    targetPort = availablePort;
    configManager.update({ port: availablePort });
  }

  const app = createBridgeApp();
  const server = http.createServer(app);

  server.listen(targetPort, host, () => {
    printBanner({
      port: targetPort,
      host,
      antigravityConnected: !!instance,
      activePort: instance?.port,
      pid: instance?.pid,
      defaultModel: configManager.get().defaultModel,
      account: accountDetails,
    });

    console.log(chalk.bold.green(`  🚀 Ready to receive agent requests!`));
    console.log(chalk.gray(`  (Press Ctrl+C to stop the server)\n`));

    if (options.open || config.openBrowserOnStart) {
      open(`http://${host}:${targetPort}/dashboard`).catch(() => {});
    }
  });

  server.on('error', (err: any) => {
    logger.error(`Server Error: ${err.message}`);
    console.log('\nPress Enter to exit...');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('', () => process.exit(1));
  });
}
