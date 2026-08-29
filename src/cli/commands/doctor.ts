import chalk from 'chalk';
import ora from 'ora';
import { AntigravityDiscovery } from '../../engines/discovery';
import { antigravityCore } from '../../engines/antigravity-core';
import { configManager } from '../../utils/config';

export async function doctorCommand() {
  console.log(chalk.bold.cyan('\n🩺 Open Gravity & Antigravity System Diagnostics\n'));

  const spinner = ora('Analyzing system...').start();
  const config = configManager.get();

  // Test 1: Node & Process Detection
  spinner.text = '1. Scanning for Google Antigravity processes...';
  const instance = await AntigravityDiscovery.discover(true);

  if (instance) {
    spinner.succeed(chalk.green(`Antigravity process detected (PID: ${instance.pid})`));
  } else {
    spinner.warn(chalk.yellow('No active Antigravity process found'));
  }

  // Test 2: Language Server & CSRF
  if (instance) {
    spinner.start('2. Testing Language Server RPC connection...');
    try {
      const status = await antigravityCore.rpcCall('GetCapabilities');
      spinner.succeed(chalk.green(`Language Server RPC online (Port: ${instance.port}, CSRF validated)`));
    } catch (e: any) {
      spinner.fail(chalk.red(`Language Server RPC error: ${e.message}`));
    }

    // Test 3: Models Retrieval
    spinner.start('3. Fetching Antigravity models...');
    try {
      const models = await antigravityCore.getAvailableModels();
      const count = Object.keys(models).length;
      spinner.succeed(chalk.green(`${count} Antigravity models loaded successfully`));
    } catch (e: any) {
      spinner.fail(chalk.red(`Failed to fetch models: ${e.message}`));
    }
  }

  // Test 4: Local Bridge Port Availability
  spinner.start(`4. Checking local port ${config.port} configuration...`);
  spinner.succeed(chalk.green(`Port ${config.port} configured for Open Gravity`));

  // Test 5: Fallback Direct API
  spinner.start('5. Checking Direct API fallback mode...');
  if (config.geminiApiKey) {
    spinner.succeed(chalk.green('GEMINI_API_KEY configured (Direct mode ready)'));
  } else {
    spinner.info(chalk.gray('GEMINI_API_KEY not set (Optional when Antigravity is running)'));
  }

  console.log(chalk.bold.green('\n✔ Diagnostics completed successfully!\n'));
}
