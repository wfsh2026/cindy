import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const scriptDirectory = path.dirname(scriptPath);
const sourceRoot = path.resolve(scriptDirectory, '../../../mods/cartethyia-battle');

async function main() {
  const manifestPath = path.join(sourceRoot, 'manifest.json');
  const raw = await readFile(manifestPath, 'utf8');
  const manifest = JSON.parse(raw);
  const assets = {};
  const assetRoot = path.join(sourceRoot, 'assets');
  const entries = Object.entries(manifest.assets);
  for (const [key, filename] of entries) {
    if (!/^[a-z0-9-]+\.png$/.test(filename)) throw new Error('Invalid asset filename');
    const file = path.join(assetRoot, filename);
    const bytes = await readFile(file);
    const digest = createHash('sha256');
    digest.update(bytes);
    const sha256 = digest.digest('hex');
    const base64 = bytes.toString('base64');
    assets[key] = { sha256, base64 };
  }
  const pack = { ...manifest, assets };
  const json = JSON.stringify(pack);
  const defaultOutput = path.resolve(scriptDirectory, `../release/mods/${manifest.id}-${manifest.version}.cindymod`);
  const output = process.argv[2] ? path.resolve(process.argv[2]) : defaultOutput;
  const outputDirectory = path.dirname(output);
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(output, json);
  const checksum = createHash('sha256');
  checksum.update(json);
  const sha256 = checksum.digest('hex');
  const bytes = Buffer.byteLength(json);
  console.log(JSON.stringify({ output, bytes, sha256 }));
}

await main();
