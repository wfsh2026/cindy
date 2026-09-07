import { randomUUID } from 'node:crypto';
import { BATTLE_ASSET_IDS, PERSONAL_MOD_ID, isInstalledPersonalMod } from '../../shared/personalMod';
import type { InstalledPersonalMod } from '../../shared/personalMod';
import { decodePersonalMod } from './package';

export interface PersonalModState {
  version: 1;
  installed: InstalledPersonalMod | null;
  pending: string[];
}

export interface PersonalModPorts {
  read(): PersonalModState;
  write(state: PersonalModState): void;
  assertCurrent(): void;
  ingest(buffer: Buffer, revision: string): Promise<string>;
  release(revision: string): Promise<void>;
}

export function parsePersonalModState(raw: string | null): PersonalModState {
  if (raw === null) return { version: 1, installed: null, pending: [] };
  const state = JSON.parse(raw) as PersonalModState;
  const validInstalled = state?.installed === null || isInstalledPersonalMod(state?.installed);
  if (state?.version !== 1 || !validInstalled || !Array.isArray(state.pending) || state.pending.length > 64) throw new Error('Invalid Mod state');
  for (const revision of state.pending) {
    if (typeof revision !== 'string' || !/^[a-f0-9-]{36}$/.test(revision) || revision === state.installed?.revision) throw new Error('Invalid Mod journal');
  }
  return state;
}

/** Caller holds the owner-scoped lock for the complete operation, including recovery. */
export class PersonalModService {
  constructor(private readonly ports: PersonalModPorts) {}

  async get(): Promise<InstalledPersonalMod | null> {
    this.ports.assertCurrent();
    const state = this.ports.read();
    await this.cleanup(state);
    return state.installed;
  }

  async install(bytes: Buffer): Promise<InstalledPersonalMod> {
    const decoded = await decodePersonalMod(bytes);
    this.ports.assertCurrent();
    const state = this.ports.read();
    await this.cleanup(state);
    if (state.pending.length >= 63) throw new Error('Mod cleanup pending');
    const revision = randomUUID();
    state.pending.push(revision);
    // Journal the whole revision before ingest; survives crashes and lost DB acknowledgements.
    this.ports.write(state);
    const assets = {} as InstalledPersonalMod['assets'];
    try {
      for (const key of BATTLE_ASSET_IDS) {
        this.ports.assertCurrent();
        assets[key] = await this.ports.ingest(decoded.assets[key], revision);
      }
      this.ports.assertCurrent();
      const installed: InstalledPersonalMod = { id: PERSONAL_MOD_ID, version: decoded.version, revision, assets };
      const keepPending = (entry: string) => entry !== revision;
      const pending = state.pending.filter(keepPending);
      if (state.installed) pending.push(state.installed.revision);
      const next: PersonalModState = { version: 1, installed, pending };
      this.ports.write(next);
      await this.cleanup(next);
      return installed;
    } catch (error) {
      // The durable pending revision remains if the owner/worker is already gone.
      await this.cleanup(state);
      throw error;
    }
  }

  async remove(revision: string): Promise<void> {
    this.ports.assertCurrent();
    const state = this.ports.read();
    if (!state.installed || state.installed.revision !== revision) throw new Error('Mod changed');
    const pending = [...state.pending, revision];
    const next: PersonalModState = { version: 1, installed: null, pending };
    this.ports.write(next);
    await this.cleanup(next);
  }

  private async cleanup(state: PersonalModState): Promise<void> {
    for (const revision of [...state.pending]) {
      try {
        this.ports.assertCurrent();
        await this.ports.release(revision);
        this.ports.assertCurrent();
        const keep = (entry: string) => entry !== revision;
        const pending = state.pending.filter(keep);
        const next = { ...state, pending };
        this.ports.write(next);
        state.pending = pending;
      } catch {
        // Cleanup failure cannot turn a committed installation into a failed update.
        return;
      }
    }
  }
}
