import fs from 'node:fs/promises';
import path from 'node:path';
import { loadAppearancePack, readAppearanceManifest } from '../local-themes/appearancePacks';
import { isRealPathWithinRoot, readBoundedFileNoFollow } from '../utils/readBoundedFile';
import { APPEARANCE_ASSET_KEYS } from '../../shared/appearanceMod';

/** Copy only declared resources; never recursively walk an untrusted source tree. */
export async function copyAppearanceDirectory(source: string, destination: string): Promise<string> {
  const root = await fs.realpath(source);
  const manifest = readAppearanceManifest(root);
  loadAppearancePack(root);
  const resources = new Set<string>();
  for (const mode of ['light', 'dark'] as const) {
    const colors = manifest.colors?.[mode];
    if (colors) resources.add(colors);
    for (const key of APPEARANCE_ASSET_KEYS) {
      const filename = manifest.assets?.[mode]?.[key];
      if (filename) resources.add(filename);
    }
  }
  await fs.mkdir(destination, { recursive: true });
  const parent = await fs.realpath(destination);
  const id = manifest.id.slice(0, 40);
  const prefix = path.join(parent, `.theme-${id}-`);
  const staging = await fs.mkdtemp(prefix);
  const basename = path.basename(staging);
  const name = basename.slice(1);
  const target = path.join(parent, name);
  if (!isRealPathWithinRoot(staging, parent) || !isRealPathWithinRoot(target, parent)) throw new Error('Invalid copy destination');
  try {
    let total = 0;
    for (const relative of resources) {
      const file = path.join(root, relative);
      const options = { containWithin: root, nonBlocking: true, verifyContentStability: true };
      const bytes = await readBoundedFileNoFollow(file, 8 * 1024 * 1024, options);
      if (!bytes) throw new Error('Mod source changed');
      total += bytes.length;
      if (total > 64 * 1024 * 1024) throw new Error('Mod source too large');
      const output = path.join(staging, relative);
      if (!isRealPathWithinRoot(output, staging)) throw new Error('Invalid resource destination');
      const directory = path.dirname(output);
      await fs.mkdir(directory, { recursive: true });
      await fs.writeFile(output, bytes, { flag: 'wx' });
    }
    const next = { ...manifest, id: name.toLowerCase(), name: `${manifest.name.slice(0, 70)} Copy` };
    const raw = JSON.stringify(next, null, 2);
    const manifestFile = path.join(staging, 'manifest.json');
    await fs.writeFile(manifestFile, raw, { flag: 'wx' });
    loadAppearancePack(staging);
    try { await fs.lstat(target); throw new Error('Copy destination exists'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    await fs.rename(staging, target);
    return target;
  } catch (error) {
    try {
      const stat = await fs.lstat(staging);
      const realStaging = await fs.realpath(staging);
      if (!stat.isSymbolicLink() && realStaging === staging && isRealPathWithinRoot(realStaging, parent)) await fs.rm(realStaging, { recursive: true, force: true });
    } catch { /* An uncertain cleanup must not touch any other source directory. */ }
    throw error;
  }
}
