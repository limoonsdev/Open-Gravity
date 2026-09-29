// Web panel assets. In the bundled build (and the .exe) they are inlined by
// esbuild via `define`; in dev mode (tsx) they are read from src/web.
import fs from 'fs';
import path from 'path';

declare const __OG_PANEL_HTML__: string;
declare const __OG_LOGO_SVG__: string;

function fromDisk(name: string): string {
  const candidates = [path.join(__dirname, '..', 'web', name), path.join(process.cwd(), 'src', 'web', name)];
  for (const c of candidates) {
    try {
      return fs.readFileSync(c, 'utf8');
    } catch { /* next */ }
  }
  return '';
}

export function panelHtml(): string {
  return typeof __OG_PANEL_HTML__ !== 'undefined' ? __OG_PANEL_HTML__ : fromDisk('index.html');
}

export function logoSvg(): string {
  return typeof __OG_LOGO_SVG__ !== 'undefined' ? __OG_LOGO_SVG__ : fromDisk('logo.svg');
}
