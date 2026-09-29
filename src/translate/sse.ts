// Incremental Server-Sent Events parser (spec-compliant enough for LLM APIs).

export interface SSEMessage {
  event?: string;
  data: string;
}

export class SSEParser {
  private buffer = '';
  private event: string | undefined;
  private dataLines: string[] = [];

  /** Feed a decoded text chunk; returns complete messages. */
  push(chunk: string): SSEMessage[] {
    this.buffer += chunk;
    const out: SSEMessage[] = [];
    let idx: number;
    // Process complete lines only.
    while ((idx = this.nextLineBreak()) >= 0) {
      let line = this.buffer.slice(0, idx);
      const skip = this.buffer[idx] === '\r' && this.buffer[idx + 1] === '\n' ? 2 : 1;
      this.buffer = this.buffer.slice(idx + skip);
      if (line.endsWith('\r')) line = line.slice(0, -1);
      this.handleLine(line, out);
    }
    return out;
  }

  /** Flush a trailing message when the stream ends without a blank line. */
  end(): SSEMessage[] {
    const out: SSEMessage[] = [];
    if (this.buffer.length) {
      this.handleLine(this.buffer, out);
      this.buffer = '';
    }
    this.dispatch(out);
    return out;
  }

  private nextLineBreak(): number {
    const n = this.buffer.indexOf('\n');
    const r = this.buffer.indexOf('\r');
    if (r >= 0 && (n < 0 || r < n)) {
      // A lone '\r' at the very end may be the first half of '\r\n'.
      if (r === this.buffer.length - 1) return -1;
      return r;
    }
    return n;
  }

  private handleLine(line: string, out: SSEMessage[]) {
    if (line === '') {
      this.dispatch(out);
      return;
    }
    if (line.startsWith(':')) return;
    const colon = line.indexOf(':');
    const field = colon >= 0 ? line.slice(0, colon) : line;
    let value = colon >= 0 ? line.slice(colon + 1) : '';
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') this.event = value;
    else if (field === 'data') this.dataLines.push(value);
  }

  private dispatch(out: SSEMessage[]) {
    if (this.dataLines.length) {
      out.push({ event: this.event, data: this.dataLines.join('\n') });
    }
    this.event = undefined;
    this.dataLines = [];
  }
}

export function sseData(data: unknown, event?: string): string {
  const payload = typeof data === 'string' ? data : JSON.stringify(data);
  return `${event ? `event: ${event}\n` : ''}data: ${payload}\n\n`;
}
