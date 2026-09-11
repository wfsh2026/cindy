import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { BATTLE_ASSET_IDS, PERSONAL_MOD_MAX_BYTES, type PersonalModPackage } from '../../shared/personalMod';
import { readBoundedFileNoFollow, isRealPathWithinRoot } from '../utils/readBoundedFile';

export async function readBattleDirectory(directory: string): Promise<Buffer> {
  const root = await fs.realpath(directory);
  const options = { containWithin: root, nonBlocking: true, verifyContentStability: true };
  const manifestPath = path.join(root, 'manifest.json');
  const bytes = await readBoundedFileNoFollow(manifestPath, 64 * 1024, options);
  if (!bytes) throw new Error('Invalid Mod manifest');
  const text = bytes.toString('utf8');
  const manifest = JSON.parse(text);
  const assets: PersonalModPackage['assets'] = {} as PersonalModPackage['assets'];
  let total = bytes.length;
  for (const id of BATTLE_ASSET_IDS) {
    const filename = manifest.assets?.[id];
    if (typeof filename !== 'string' || !/^[a-z0-9-]+\.png$/.test(filename)) throw new Error('Invalid Mod asset');
    const file = path.join(root, 'assets', filename);
    const data = await readBoundedFileNoFollow(file, 2 * 1024 * 1024, options);
    if (!data) throw new Error('Cannot read Mod asset');
    total += data.length;
    if (total > PERSONAL_MOD_MAX_BYTES / 2) throw new Error('Mod assets too large');
    const hash = createHash('sha256');
    hash.update(data);
    const sha256 = hash.digest('hex');
    const base64 = data.toString('base64');
    assets[id] = { sha256, base64 };
  }
  const result = { ...manifest, assets };
  const raw = JSON.stringify(result);
  return Buffer.from(raw);
}

export async function createModExample(request: { source: string; destination: string; name: string }): Promise<string> {
  const source = await fs.realpath(request.source);
  const parent = await fs.realpath(request.destination);
  const prefix = path.join(parent, `${request.name}-copy-`);
  const destination = await fs.mkdtemp(prefix);
  const resolved = await fs.realpath(destination);
  if (!isRealPathWithinRoot(resolved, parent)) throw new Error('Invalid export directory');
  const entries = await fs.readdir(source, { recursive: true, withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || entry.isSymbolicLink()) continue;
    const original = path.join(entry.parentPath, entry.name);
    const relative = path.relative(source, original);
    const target = path.join(resolved, relative);
    const options = { containWithin: source, nonBlocking: true, verifyContentStability: true };
    const bytes = await readBoundedFileNoFollow(original, PERSONAL_MOD_MAX_BYTES, options);
    if (!bytes) throw new Error('Cannot copy Mod example');
    const targetParent = path.dirname(target);
    await fs.mkdir(targetParent, { recursive: true });
    await fs.writeFile(target, bytes, { flag: 'wx' });
  }
  const manifestPath = path.join(resolved, 'manifest.json');
  const guideRoot = path.dirname(source);
  const guidePath = path.join(guideRoot, 'README.md');
  const guideOptions = { containWithin: guideRoot, nonBlocking: true };
  const guide = await readBoundedFileNoFollow(guidePath, 64 * 1024, guideOptions);
  if (guide) {
    const guideTarget = path.join(resolved, 'README.md');
    await fs.writeFile(guideTarget, guide, { flag: 'wx' });
  }
  const raw = await fs.readFile(manifestPath, 'utf8');
  const manifest = JSON.parse(raw);
  manifest.id = path.basename(resolved).toLowerCase();
  manifest.name = `${manifest.name ?? '卡提西亚战斗'} Copy`;
  const content = JSON.stringify(manifest, null, 2);
  await fs.writeFile(manifestPath, content);
  return resolved;
}

export async function manageModDirectory(root: string, request: { action: 'open' | 'uninstall' | 'restore'; directory: string }): Promise<string> {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(request.directory)) throw new Error('Invalid Mod directory');
  await fs.mkdir(root, { recursive: true });
  const realRoot = await fs.realpath(root);
  const disabled = path.join(realRoot, '.disabled');
  await fs.mkdir(disabled, { recursive: true });
  const realDisabled = await fs.realpath(disabled);
  if (!isRealPathWithinRoot(realDisabled, realRoot)) throw new Error('Invalid disabled directory');
  const sourceRoot = request.action === 'restore' ? realDisabled : realRoot;
  const source = path.join(sourceRoot, request.directory);
  const stat = await fs.lstat(source);
  const realSource = await fs.realpath(source);
  if (!stat.isDirectory() || stat.isSymbolicLink() || !isRealPathWithinRoot(realSource, sourceRoot)) throw new Error('Invalid Mod directory');
  if (request.action === 'open') return realSource;
  const destinationRoot = request.action === 'restore' ? realRoot : realDisabled;
  const destination = path.join(destinationRoot, request.directory);
  try { await fs.lstat(destination); throw new Error('Destination already exists'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  if (!isRealPathWithinRoot(destination, realRoot)) throw new Error('Invalid destination');
  await fs.rename(realSource, destination);
  return destination;
}
