import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PERSONAL_MOD_IPC } from '../../../shared/personalMod';
import { registerPersonalModIpc } from '../register';

const context = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => Promise<unknown>>(),
  snapshot: { client: { drizzle: {} }, userId: 'test-owner' } as object | null,
  trusted: true,
  picker: vi.fn(),
  reader: vi.fn(),
  install: vi.fn(),
  get: vi.fn(),
  remove: vi.fn(),
}));

vi.mock('electron', () => ({
  app: { getPath: () => 'test-user-data' },
  ipcMain: { handle: (channel: string, callback: (...args: unknown[]) => Promise<unknown>) => context.handlers.set(channel, callback) },
  BrowserWindow: { fromWebContents: () => null, getAllWindows: () => [] },
  dialog: { showOpenDialog: (...args: unknown[]) => context.picker(...args) },
}));
vi.mock('node:fs/promises', () => ({ mkdir: async () => undefined }));
vi.mock('../../security/trustedAppRenderer', () => ({ assertTrustedAppRendererEvent: () => { if (!context.trusted) throw new Error('untrusted'); } }));
vi.mock('../../windowFocusClassifier', () => ({ isAppContentWindow: () => true }));
vi.mock('../../appSessionState', () => ({ getActiveAppSession: () => ({ dataOwnerId: 'test-owner' }) }));
vi.mock('../../localDb/client/current', () => ({ getCurrentDbClientSnapshot: () => context.snapshot }));
vi.mock('../../cindy-media/refCompensationJournal', () => ({ captureMediaRefCompensationScope: () => ({ ownerStorageKey: 'test-owner-hash', assertStillValid: () => undefined }) }));
vi.mock('../../cindy-media/ingest', () => ({ ingestMedia: vi.fn() }));
vi.mock('../../cindy-media/ledger', () => ({ removeRefs: vi.fn() }));
vi.mock('../../utils/atomicWriteFile', () => ({ atomicWriteFileSync: vi.fn(), readAtomicFileSync: vi.fn() }));
vi.mock('../../utils/readBoundedFile', () => ({ readBoundedFileNoFollow: (...args: unknown[]) => context.reader(...args) }));
vi.mock('../../device-link/crossProcessLock', () => ({ withCrossProcessLock: async (_path: string, _options: object, action: (lock: object) => Promise<unknown>) => {
  const lock = { held: true };
  return action(lock);
} }));
vi.mock('../service', () => ({
  parsePersonalModState: vi.fn(),
  PersonalModService: class {
    get = context.get;
    install = context.install;
    remove = context.remove;
  },
}));

async function invoke(channel: string, payload?: unknown) {
  const handler = context.handlers.get(channel);
  if (!handler) throw new Error('Missing handler');
  const event = { sender: {} };
  return handler(event, payload);
}

beforeEach(() => {
  vi.clearAllMocks();
  context.handlers.clear();
  context.trusted = true;
  context.snapshot = { client: { drizzle: {} }, userId: 'test-owner' };
  context.picker.mockResolvedValue({ canceled: true, filePaths: [] });
  context.get.mockResolvedValue(null);
  context.install.mockResolvedValue(null);
  registerPersonalModIpc();
});

describe('Personal Mod IPC boundaries', () => {
  it('rejects every operation from an untrusted renderer before opening files', async () => {
    context.trusted = false;
    for (const channel of [PERSONAL_MOD_IPC.get, PERSONAL_MOD_IPC.import, PERSONAL_MOD_IPC.remove]) {
      const request = invoke(channel);
      await expect(request).rejects.toThrow('untrusted');
    }
    expect(context.picker).not.toHaveBeenCalled();
    expect(context.reader).not.toHaveBeenCalled();
  });

  it('does no file access or installation when the picker is canceled', async () => {
    const result = await invoke(PERSONAL_MOD_IPC.import);
    expect(result).toEqual({ ok: true, mod: null, canceled: true });
    expect(context.reader).not.toHaveBeenCalled();
    expect(context.install).not.toHaveBeenCalled();
  });

  it('rejects an owner change while the native file picker is open', async () => {
    context.picker.mockImplementation(async () => {
      context.snapshot = null;
      return { canceled: false, filePaths: ['picked.cindymod'] };
    });
    const result = await invoke(PERSONAL_MOD_IPC.import);
    expect(result).toEqual({ ok: false, error: 'unavailable' });
    expect(context.reader).not.toHaveBeenCalled();
  });

  it('reads only the native picker path, rejecting oversized and unsafe files', async () => {
    context.picker.mockResolvedValue({ canceled: false, filePaths: ['picked.cindymod'] });
    context.reader.mockResolvedValue(null);
    const result = await invoke(PERSONAL_MOD_IPC.import, 'renderer-controlled-path');
    expect(result).toEqual({ ok: false, error: 'invalid-package' });
    expect(context.reader).toHaveBeenCalledWith('picked.cindymod', 16 * 1024 * 1024, { nonBlocking: true, verifyContentStability: true });
    expect(context.install).not.toHaveBeenCalled();
  });

  it('passes selected bytes to the installation service and rejects arbitrary uninstall identifiers', async () => {
    const bytes = Buffer.from('package fixture');
    context.picker.mockResolvedValue({ canceled: false, filePaths: ['picked.cindymod'] });
    context.reader.mockResolvedValue(bytes);
    const result = await invoke(PERSONAL_MOD_IPC.import);
    expect(result).toEqual({ ok: true, mod: null });
    expect(context.install).toHaveBeenCalledWith(bytes);
    const invalidRemove = await invoke(PERSONAL_MOD_IPC.remove, '../../outside');
    expect(invalidRemove).toEqual({ ok: false, error: 'failed' });
    expect(context.remove).not.toHaveBeenCalled();
  });
});
