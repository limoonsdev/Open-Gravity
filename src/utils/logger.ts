import chalk from 'chalk';
import EventEmitter from 'events';

export interface LogEntry {
  id: string;
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug' | 'success' | 'request';
  message: string;
  meta?: any;
}

class BridgeLogger extends EventEmitter {
  private logs: LogEntry[] = [];
  private maxLogs: number = 200;
  private isMuted: boolean = false;

  public setMuted(muted: boolean) {
    this.isMuted = muted;
  }

  private addLog(level: LogEntry['level'], message: string, meta?: any) {
    const entry: LogEntry = {
      id: Math.random().toString(36).substring(2, 9),
      timestamp: new Date().toISOString().split('T')[1].split('.')[0],
      level,
      message,
      meta,
    };

    this.logs.push(entry);
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }

    this.emit('log', entry);

    if (this.isMuted) return;

    const timeStr = chalk.gray(`[${entry.timestamp}]`);
    switch (level) {
      case 'info':
        console.log(`${timeStr} ${chalk.blue('ℹ')} ${message}`);
        break;
      case 'success':
        console.log(`${timeStr} ${chalk.green('✔')} ${chalk.green(message)}`);
        break;
      case 'warn':
        console.log(`${timeStr} ${chalk.yellow('⚠')} ${chalk.yellow(message)}`);
        break;
      case 'error':
        console.log(`${timeStr} ${chalk.red('✖')} ${chalk.red(message)}`);
        if (meta?.stack) console.error(chalk.gray(meta.stack));
        break;
      case 'request':
        console.log(`${timeStr} ${chalk.magenta('⚡')} ${message}`);
        break;
      case 'debug':
        if (process.env.DEBUG) {
          console.log(`${timeStr} ${chalk.gray('⚙')} ${chalk.gray(message)}`);
        }
        break;
    }
  }

  public info(msg: string, meta?: any) {
    this.addLog('info', msg, meta);
  }

  public success(msg: string, meta?: any) {
    this.addLog('success', msg, meta);
  }

  public warn(msg: string, meta?: any) {
    this.addLog('warn', msg, meta);
  }

  public error(msg: string, meta?: any) {
    this.addLog('error', msg, meta);
  }

  public request(msg: string, meta?: any) {
    this.addLog('request', msg, meta);
  }

  public debug(msg: string, meta?: any) {
    this.addLog('debug', msg, meta);
  }

  public getRecentLogs(): LogEntry[] {
    return [...this.logs];
  }
}

export const logger = new BridgeLogger();
