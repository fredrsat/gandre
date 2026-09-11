import { tool, type ToolSet } from 'ai';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';

// Løser stien relativt til workdir og nekter alt som ender utenfor —
// realpath på nærmeste eksisterende forelder stopper også symlink-escape.
function resolveInside(workdir: string, p: string): string {
  const realWorkdir = fs.realpathSync(workdir);
  const resolved = path.resolve(realWorkdir, p);
  let probe = resolved;
  while (!fs.existsSync(probe)) probe = path.dirname(probe);
  const realProbe = fs.realpathSync(probe);
  if (realProbe !== realWorkdir && !realProbe.startsWith(realWorkdir + path.sep)) {
    throw new Error(`Stien "${p}" er utenfor arbeidsmappen`);
  }
  if (resolved !== realWorkdir && !resolved.startsWith(realWorkdir + path.sep)) {
    throw new Error(`Stien "${p}" er utenfor arbeidsmappen`);
  }
  return resolved;
}

const MAX_READ_BYTES = 512 * 1024;
export const MEMORY_FILE = 'memory.md';
export const MAX_MEMORY_BYTES = 20 * 1024;

export function readMemory(workdir: string): string {
  try {
    return fs.readFileSync(path.join(workdir, MEMORY_FILE), 'utf8').slice(0, MAX_MEMORY_BYTES);
  } catch {
    return '';
  }
}

// Minne er plattformfunksjonalitet og tilbys alltid — uavhengig av allow_write
export function buildMemoryTool(workdir: string): ToolSet {
  return {
    save_memory: tool({
      description:
        'Lagre minnet ditt til neste kjøring (erstatter hele minnet). Skriv kort og punktvis: ' +
        'hva du gjorde nå, hva neste kjøring bør vite, og hva som ikke skal gjentas. Maks ~20 KB.',
      inputSchema: z.object({
        content: z.string().describe('Det fullstendige nye minneinnholdet (markdown)'),
      }),
      execute: async ({ content }) => {
        fs.mkdirSync(workdir, { recursive: true });
        const trimmed = content.slice(0, MAX_MEMORY_BYTES);
        fs.writeFileSync(path.join(workdir, MEMORY_FILE), trimmed, 'utf8');
        return `Minne lagret (${Buffer.byteLength(trimmed)} bytes).`;
      },
    }),
  };
}

export function buildFsTools(workdir: string, allowWrite: boolean): ToolSet {
  fs.mkdirSync(workdir, { recursive: true });

  const tools: ToolSet = {
    list_files: tool({
      description: 'List filer og mapper i arbeidsmappen. Oppgi en relativ sti for undermapper.',
      inputSchema: z.object({
        path: z.string().default('.').describe('Relativ sti i arbeidsmappen'),
      }),
      execute: async ({ path: p }) => {
        const dir = resolveInside(workdir, p);
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        return entries
          .map((e) => `${e.isDirectory() ? 'dir ' : 'file'}  ${path.join(p, e.name)}`)
          .join('\n') || '(tom mappe)';
      },
    }),
    read_file: tool({
      description: 'Les innholdet i en fil i arbeidsmappen.',
      inputSchema: z.object({
        path: z.string().describe('Relativ sti til filen'),
      }),
      execute: async ({ path: p }) => {
        const file = resolveInside(workdir, p);
        const stat = fs.statSync(file);
        if (stat.size > MAX_READ_BYTES) {
          return `Filen er ${stat.size} bytes — for stor (maks ${MAX_READ_BYTES}). Les en mindre fil.`;
        }
        return fs.readFileSync(file, 'utf8');
      },
    }),
  };

  if (allowWrite) {
    tools.write_file = tool({
      description: 'Skriv (eller overskriv) en fil i arbeidsmappen. Oppretter mapper ved behov.',
      inputSchema: z.object({
        path: z.string().describe('Relativ sti til filen'),
        content: z.string().describe('Filinnholdet'),
      }),
      execute: async ({ path: p, content }) => {
        const file = resolveInside(workdir, p);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, content, 'utf8');
        return `Skrev ${Buffer.byteLength(content)} bytes til ${p}`;
      },
    });
  }

  return tools;
}
