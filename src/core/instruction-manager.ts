import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';

export const INSTRUCTION_MARKER =
  '# ── USER CUSTOMIZATIONS ──────────────────────────────────────────────────────\n# Everything below this line is yours. The app will never overwrite it.\n# Add your custom rules, account mappings, or extra instructions here.\n';

export const INSTRUCTIONS_DIR = 'instructions';

export function splitZones(content: string): { systemZone: string; userZone: string } {
  const markerIndex = content.indexOf(INSTRUCTION_MARKER);
  if (markerIndex === -1) {
    return { systemZone: content, userZone: '' };
  }
  return {
    systemZone: content.slice(0, markerIndex),
    userZone: content.slice(markerIndex + INSTRUCTION_MARKER.length),
  };
}

export function joinZones(systemZone: string, userZone: string): string {
  return systemZone.trimEnd() + '\n\n' + INSTRUCTION_MARKER + userZone;
}

export function systemZoneHash(systemZone: string): string {
  return createHash('sha256').update(systemZone).digest('hex');
}

export async function writeInstruction(filePath: string, bundledSystemZone: string): Promise<void> {
  const bundledHash = systemZoneHash(bundledSystemZone);

  let userZone = '';
  try {
    const existing = await fs.promises.readFile(filePath, 'utf-8');
    const zones = splitZones(existing);
    if (systemZoneHash(zones.systemZone) === bundledHash) {
      return;
    }
    userZone = zones.userZone;
  } catch {
    // file doesn't exist yet — write fresh
  }

  const dir = path.dirname(filePath);
  await fs.promises.mkdir(dir, { recursive: true });
  await fs.promises.writeFile(filePath, joinZones(bundledSystemZone, userZone), 'utf-8');
}

export async function readInstruction(filePath: string): Promise<string> {
  return fs.promises.readFile(filePath, 'utf-8');
}
