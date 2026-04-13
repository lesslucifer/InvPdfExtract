import * as crypto from 'crypto';
import * as path from 'path';

const VAULTS_SUBDIR = 'vaults';
const SLUG_HASH_LENGTH = 12;
const SLUG_PREFIX_MAX_LENGTH = 40;

let userDataPath: string | null = null;

export function setUserDataPath(p: string): void {
  userDataPath = p;
}

export function getUserDataPath(): string {
  if (!userDataPath) throw new Error('userDataPath not set — call setUserDataPath() first');
  return userDataPath;
}

export function getVaultSlug(rootPath: string): string {
  const normalized = path.resolve(rootPath);
  const hash = crypto.createHash('sha256').update(normalized).digest('hex').slice(0, SLUG_HASH_LENGTH);

  const sanitized = normalized
    .replace(/^\//, '')           // strip leading slash
    .replace(/[/\\]/g, '_')      // path separators → _
    .replace(/[^a-zA-Z0-9_.-]/g, '-') // special chars → -
    .replace(/-{2,}/g, '-')      // collapse repeated dashes
    .slice(0, SLUG_PREFIX_MAX_LENGTH);

  return `${sanitized}_${hash}`;
}

export function getVaultDotPath(rootPath: string): string {
  return path.join(getUserDataPath(), VAULTS_SUBDIR, getVaultSlug(rootPath));
}
