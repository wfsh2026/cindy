import { app, BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent, type OpenDialogOptions } from 'electron';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { PERSONAL_MOD_IPC, PERSONAL_MOD_MAX_BYTES } from '../../shared/personalMod';
import type { InstalledPersonalMod, PersonalModResult } from '../../shared/personalMod';
import { captureMediaRefCompensationScope } from '../cindy-media/refCompensationJournal';
import { ingestMedia, type IngestMediaParams } from '../cindy-media/ingest';
import { removeRefs } from '../cindy-media/ledger';
import { getCurrentDbClientSnapshot } from '../localDb/client/current';
import { atomicWriteFileSync, readAtomicFileSync } from '../utils/atomicWriteFile';
import { readBoundedFileNoFollow } from '../utils/readBoundedFile';
import { withCrossProcessLock, type LockStatus } from '../device-link/crossProcessLock';
import { assertTrustedAppRendererEvent } from '../security/trustedAppRenderer';
import { isAppContentWindow } from '../windowFocusClassifier';
import { getActiveAppSession } from '../appSessionState';
import { InvalidPersonalModError } from './package';
import { PersonalModService, parsePersonalModState, type PersonalModPorts } from './service';
import { createModExample, manageModDirectory, readBattleDirectory } from './directories';
import { getLocalThemesDir } from '../local-themes/loader';
import { readModIdentity, writeModIdentity } from './identity';
import { throwIpcError } from '../utils/ipcValidate';
import { writeAppearanceSelection } from './appearance';
import { copyAppearanceDirectory } from './appearanceDirectories';

class ModUnavailableError extends Error {}

async function withService(action: (service: PersonalModService) => Promise<InstalledPersonalMod | null>): Promise<PersonalModResult> {
  try {
    const snapshot = getCurrentDbClientSnapshot();
    const owner = getActiveAppSession();
    if (!snapshot || snapshot.userId !== owner.dataOwnerId) throw new ModUnavailableError();
    const scope = captureMediaRefCompensationScope();
    const db = snapshot.client.drizzle;
    const assertCurrent = () => {
      scope.assertStillValid();
      if (getCurrentDbClientSnapshot() !== snapshot) throw new ModUnavailableError();
    };
    const userData = app.getPath('userData');
    const directory = path.join(userData, 'owners', scope.ownerStorageKey, 'personal-mods');
    const statePath = path.join(directory, 'installed-v1.json');
    const lockPath = path.join(directory, 'install.lock');
    const ports: PersonalModPorts = {
      assertCurrent,
      read: () => {
        assertCurrent();
        const raw = readAtomicFileSync(statePath);
        return parsePersonalModState(raw);
      },
      write: (state) => {
        assertCurrent();
        const raw = JSON.stringify(state);
        atomicWriteFileSync(statePath, raw);
      },
      ingest: async (buffer, revision) => {
        const refId = `personal-mod:${revision}`;
        const params: IngestMediaParams = { buffer, mimeType: 'image/png', isCache: false,
          refs: [{ refKind: 'import', refId, originKind: 'user', originId: snapshot.userId }],
          assertStillValid: assertCurrent, refCompensationScope: scope };
        const result = await ingestMedia(params, db);
        return result.url;
      },
      release: async (revision) => {
        assertCurrent();
        const params = { refKind: 'import' as const, refId: `personal-mod:${revision}` };
        await removeRefs(params, db);
      },
    };
    await mkdir(directory, { recursive: true });
    assertCurrent();
    const task = async (lock: LockStatus): Promise<PersonalModResult> => {
      if (!lock.held) throw new ModUnavailableError();
      assertCurrent();
      const service = new PersonalModService(ports);
      const mod = await action(service);
      assertCurrent();
      return { ok: true, mod };
    };
    const lockOptions = { label: 'personal-mod-install', waitMs: 3000 };
    return await withCrossProcessLock(lockPath, lockOptions, task);
  } catch (error) {
    const code = error instanceof InvalidPersonalModError ? 'invalid-package' : error instanceof ModUnavailableError ? 'unavailable' : 'failed';
    return { ok: false, error: code };
  }
}

function broadcastChanged(): void {
  const windows = BrowserWindow.getAllWindows();
  for (const window of windows) {
    if (window.isDestroyed() || window.webContents.isDestroyed() || !isAppContentWindow(window)) continue;
    window.webContents.send(PERSONAL_MOD_IPC.changed);
  }
}

async function getMod(event: IpcMainInvokeEvent): Promise<PersonalModResult> {
  assertTrustedAppRendererEvent(event);
  const read = (service: PersonalModService) => service.get();
  return withService(read);
}

async function importMod(event: IpcMainInvokeEvent): Promise<PersonalModResult> {
  assertTrustedAppRendererEvent(event);
  const initialOwner = getCurrentDbClientSnapshot();
  if (!initialOwner) return { ok: false, error: 'unavailable' };
  const parent = BrowserWindow.fromWebContents(event.sender);
  const options: OpenDialogOptions = { properties: ['openFile'], filters: [{ name: 'Cindy Mod', extensions: ['cindymod'] }] };
  try {
    const choice = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
    assertTrustedAppRendererEvent(event);
    if (initialOwner !== getCurrentDbClientSnapshot()) return { ok: false, error: 'unavailable' };
    if (choice.canceled || !choice.filePaths[0]) return { ok: true, mod: null, canceled: true };
    const readOptions = { nonBlocking: true, verifyContentStability: true };
    const bytes = await readBoundedFileNoFollow(choice.filePaths[0], PERSONAL_MOD_MAX_BYTES, readOptions);
    if (!bytes) return { ok: false, error: 'invalid-package' };
    assertTrustedAppRendererEvent(event);
    if (initialOwner !== getCurrentDbClientSnapshot()) return { ok: false, error: 'unavailable' };
    const install = (service: PersonalModService) => service.install(bytes);
    const result = await withService(install);
    if (result.ok) broadcastChanged();
    return result;
  } catch { return { ok: false, error: 'failed' }; }
}

async function removeMod(event: IpcMainInvokeEvent, revision: unknown): Promise<PersonalModResult> {
  assertTrustedAppRendererEvent(event);
  if (typeof revision !== 'string' || !/^[a-f0-9-]{36}$/.test(revision)) return { ok: false, error: 'failed' };
  const remove = async (service: PersonalModService) => {
    await service.remove(revision);
    return null;
  };
  const result = await withService(remove);
  if (result.ok) broadcastChanged();
  return result;
}

// Desktop-local decoration: no workdir access, remote invoke allowance, or mobile installation.
export function registerPersonalModIpc(): void {
  ipcMain.handle('personal-mod:theme-import', importThemeDirectory);
  ipcMain.handle('personal-mod:appearance-selection', (event, value: unknown) => {
    assertTrustedAppRendererEvent(event);
    try { writeAppearanceSelection(value); }
    catch { throwIpcError('PRECONDITION_FAILED', 'Theme selection could not be saved'); }
  });
  ipcMain.handle('personal-mod:identity-get', event => { assertTrustedAppRendererEvent(event); return readModIdentity(); });
  ipcMain.handle('personal-mod:identity-set', (event, value: unknown) => {
    assertTrustedAppRendererEvent(event);
    try {
      const result = writeModIdentity(value);
      broadcastChanged();
      return result;
    } catch { throwIpcError('PRECONDITION_FAILED', 'Name settings could not be saved'); }
  });
  ipcMain.handle(PERSONAL_MOD_IPC.get, getMod);
  ipcMain.handle(PERSONAL_MOD_IPC.import, importMod);
  ipcMain.handle(PERSONAL_MOD_IPC.remove, removeMod);
  ipcMain.handle(PERSONAL_MOD_IPC.example, exportExample);
  ipcMain.handle(PERSONAL_MOD_IPC.directory, manageDirectory);
  ipcMain.handle(PERSONAL_MOD_IPC.importDirectory, importDirectory);
}

async function exportExample(event: IpcMainInvokeEvent, kind: unknown) {
  assertTrustedAppRendererEvent(event);
  if (kind !== 'theme' && kind !== 'battle') throwIpcError('INVALID_PARAMS', 'Invalid Mod type');
  try {
    const appRoot = app.getAppPath();
    const root = app.isPackaged ? path.join(process.resourcesPath, 'mods') : path.resolve(appRoot, '../../mods');
    const name = kind === 'theme' ? 'cartethyia-theme' : 'cartethyia-battle';
    const source = path.join(root, name);
    const themesRoot = getLocalThemesDir();
    const destination = kind === 'theme' ? path.join(themesRoot, 'packs') : path.resolve(themesRoot, '../mods');
    await mkdir(destination, { recursive: true });
    const request = { source, destination, name };
    const created = await createModExample(request);
    await shell.openPath(created);
    broadcastChanged();
    return { success: true, path: created };
  } catch { throwIpcError('PRECONDITION_FAILED', 'Cannot create Mod example'); }
}

async function manageDirectory(event: IpcMainInvokeEvent, payload: unknown) {
  assertTrustedAppRendererEvent(event);
  if (!payload || typeof payload !== 'object') throwIpcError('INVALID_PARAMS', 'Invalid Mod request');
  const request = payload as { action: 'open' | 'uninstall' | 'restore' | 'copy'; directory: string };
  if (!['open', 'uninstall', 'restore', 'copy'].includes(request.action) || typeof request.directory !== 'string') throwIpcError('INVALID_PARAMS', 'Invalid Mod request');
  try {
    const themesRoot = getLocalThemesDir();
    const root = path.join(themesRoot, 'packs');
    if (request.action === 'copy') {
      const locate = { action: 'open' as const, directory: request.directory };
      const source = await manageModDirectory(root, locate);
      const created = await copyAppearanceDirectory(source, root);
      await shell.openPath(created);
      broadcastChanged();
      return { success: true, path: created };
    }
    const directoryRequest = { ...request, action: request.action };
    const result = await manageModDirectory(root, directoryRequest);
    if (request.action === 'open') await shell.openPath(result);
    else broadcastChanged();
    return { success: true, path: result };
  } catch { throwIpcError('PRECONDITION_FAILED', 'Cannot change Mod directory'); }
}

async function importThemeDirectory(event: IpcMainInvokeEvent) {
  assertTrustedAppRendererEvent(event);
  const parent = BrowserWindow.fromWebContents(event.sender);
  const options: OpenDialogOptions = { properties: ['openDirectory'] };
  const choice = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
  if (choice.canceled || !choice.filePaths[0]) return { success: true, canceled: true, path: '' };
  assertTrustedAppRendererEvent(event);
  try {
    const themes = getLocalThemesDir();
    const destination = path.join(themes, 'packs');
    const created = await copyAppearanceDirectory(choice.filePaths[0], destination);
    broadcastChanged();
    return { success: true, path: created };
  } catch { throwIpcError('PRECONDITION_FAILED', 'Theme source could not be imported'); }
}

async function importDirectory(event: IpcMainInvokeEvent): Promise<PersonalModResult> {
  assertTrustedAppRendererEvent(event);
  const initialOwner = getCurrentDbClientSnapshot();
  if (!initialOwner) return { ok: false, error: 'unavailable' };
  const options: OpenDialogOptions = { properties: ['openDirectory'] };
  const parent = BrowserWindow.fromWebContents(event.sender);
  try {
    const choice = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
    if (choice.canceled || !choice.filePaths[0]) return { ok: true, mod: null, canceled: true };
    const bytes = await readBattleDirectory(choice.filePaths[0]);
    assertTrustedAppRendererEvent(event);
    if (initialOwner !== getCurrentDbClientSnapshot()) return { ok: false, error: 'unavailable' };
    const install = (service: PersonalModService) => service.install(bytes);
    const result = await withService(install);
    if (result.ok) broadcastChanged();
    return result;
  } catch { return { ok: false, error: 'invalid-package' }; }
}
