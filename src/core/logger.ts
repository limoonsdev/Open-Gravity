import { EventEmitter } from 'events';

export type LogLevel = 'debug' | 'info' | 'success' | 'warn' | 'error';

export interface LogEntry {
  id: number;
  ts: number;
  level: LogLevel;
  message: string;
}

const useColor = !process.env.NO_COLOR && process.stdout.isTTY;
const wrap = (code: string) => (s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);

export const c = {
  bold: wrap('1'),
  dim: wrap('2'),
  red: wrap('31'),
  green: wrap('32'),
  yellow: wrap('33'),
  blue: wrap('34'),
  magenta: wrap('35'),
  cyan: wrap('36'),
  gray: wrap('90'),
};

class Logger extends EventEmitter {
  private buffer: LogEntry[] = [];
  private seq = 0;
  quiet = false;
  debugEnabled = !!process.env.DEBUG || !!process.env.OG_DEBUG;

  private add(level: LogLevel, message: string) {
    if (level === 'debug' && !this.debugEnabled) return;
    const entry: LogEntry = { id: ++this.seq, ts: Date.now(), level, message };
    this.buffer.push(entry);
    if (this.buffer.length > 500) this.buffer.shift();
    this.emit('log', entry);
    if (this.quiet) return;
    const time = c.gray(new Date(entry.ts).toTimeString().slice(0, 8));
    const icon = { debug: c.gray('·'), info: c.blue('ℹ'), success: c.green('✔'), warn: c.yellow('⚠'), error: c.red('✖') }[level];
    const text = level === 'error' ? c.red(message) : level === 'warn' ? c.yellow(message) : level === 'debug' ? c.gray(message) : message;
    console.log(`${time} ${icon} ${text}`);
  }

  debug(m: string) { this.add('debug', m); }
  info(m: string) { this.add('info', m); }
  success(m: string) { this.add('success', m); }
  warn(m: string) { this.add('warn', m); }
  error(m: string) { this.add('error', m); }

  recent(): LogEntry[] {
    return [...this.buffer];
  }
}

export const logger = new Logger();
logger.setMaxListeners(100);
