import { readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';

const sourcePath = process.argv[2];
const outputPath = process.argv[3];
if (!sourcePath || !outputPath) throw new Error('用法: node prepare-cartethyia-ground.mjs <source.png> <output.png>');

const crop = { left: 0, top: 390, width: 2168, height: 185 };
const roadStart = 104;
const heroMask = { left: 110, right: 290, top: 0, bottom: 185 };

function isMattePixel(data, offset) {
  const red = data[offset];
  const green = data[offset + 1];
  const blue = data[offset + 2];
  const minimum = Math.min(red, green, blue);
  const maximum = Math.max(red, green, blue);
  return minimum >= 220 && maximum - minimum <= 20;
}

function removeMatte(data, width, height) {
  const count = width * height;
  const visited = new Uint8Array(count);
  const queue = [];
  const enqueue = (index) => {
    if (index < 0 || index >= count || visited[index]) return;
    visited[index] = 1;
    const offset = index * 4;
    if (!isMattePixel(data, offset)) return;
    queue.push(index);
  };
  for (let x = 0; x < width; x += 1) {
    enqueue(x);
    enqueue((height - 1) * width + x);
  }
  for (let y = 0; y < height; y += 1) {
    enqueue(y * width);
    enqueue(y * width + width - 1);
  }
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const index = queue[cursor];
    data[index * 4 + 3] = 0;
    const x = index % width;
    enqueue(index - width);
    enqueue(index + width);
    if (x > 0) enqueue(index - 1);
    if (x + 1 < width) enqueue(index + 1);
  }
}

function removePreviewHero(data, width, height) {
  const sampleX = 1200;
  for (let y = heroMask.top; y < Math.min(heroMask.bottom, height); y += 1) {
    for (let x = heroMask.left; x < Math.min(heroMask.right, width); x += 1) {
      const offset = (y * width + x) * 4;
      if (y < roadStart) {
        data[offset + 3] = 0;
        continue;
      }
      const sampleOffset = (y * width + sampleX + ((x - heroMask.left) % 80)) * 4;
      data[offset] = data[sampleOffset];
      data[offset + 1] = data[sampleOffset + 1];
      data[offset + 2] = data[sampleOffset + 2];
      data[offset + 3] = data[sampleOffset + 3];
    }
  }
}

async function main() {
  const sourceBytes = await readFile(sourcePath);
  const source = sharp(sourceBytes);
  const cropped = source.extract(crop);
  const rgba = cropped.ensureAlpha();
  const raw = rgba.raw();
  const result = await raw.toBuffer({ resolveWithObject: true });
  const data = result.data;
  const width = result.info.width;
  const height = result.info.height;
  removeMatte(data, width, height);
  removePreviewHero(data, width, height);
  for (let offset = 0; offset < data.length; offset += 4) {
    if (data[offset + 3] < 16) data[offset + 3] = 0;
  }
  const encoded = sharp(data, { raw: { width, height, channels: 4 } }).png();
  const output = await encoded.toBuffer();
  await writeFile(outputPath, output);
  console.log(`prepared ${width} x ${height} transparent ground: ${outputPath}`);
}

await main();
