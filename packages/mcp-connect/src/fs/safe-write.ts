import { mkdir, readFile, rename, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { backupPath } from './backup.js';
export async function readText(file: string): Promise<string> { try { return await readFile(file, 'utf8'); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return ''; throw e; } }
export async function safeWrite(file: string, content: string): Promise<string | null> {
  await mkdir(path.dirname(file), { recursive: true });
  const current = await readText(file);
  if (current === content) return null;
  let backup: string | null = null;
  if (current) { backup = backupPath(file); await copyFile(file, backup); }
  const temp = `${file}.tmp-${process.pid}`;
  await writeFile(temp, content, { mode: 0o600 });
  await rename(temp, file);
  return backup;
}
