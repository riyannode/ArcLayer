export function backupPath(file: string, now = new Date()): string {
  return `${file}.bak.${now.toISOString().replace(/[:.]/g, '-')}`;
}
