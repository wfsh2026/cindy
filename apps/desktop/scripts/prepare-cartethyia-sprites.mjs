import { createCanvas, loadImage } from '@napi-rs/canvas';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const scriptPath = fileURLToPath(import.meta.url);
const scriptDirectory = path.dirname(scriptPath);
const assetDirectory = path.resolve(scriptDirectory, '../src/renderer/features/composer-modes/cartethyia-battle/assets');
const frameSize = { width: 240, height: 160 };

function crop(image, rectangle) {
  const canvas = createCanvas(rectangle.width, rectangle.height);
  const context = canvas.getContext('2d');
  context.translate(-rectangle.x, -rectangle.y);
  context.drawImage(image, 0, 0);
  context.resetTransform();
  return canvas;
}

// Atlas import: only remove neutral matte connected to the cell boundary, preserving enclosed white hair/eyes.
function removeBoundaryMatte(canvas) {
  const context = canvas.getContext('2d');
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  const data = pixels.data;
  const count = canvas.width * canvas.height;
  const visited = new Uint8Array(count);
  const queue = [];
  const enqueue = (index) => {
    if (index < 0 || index >= count || visited[index]) return;
    visited[index] = 1;
    const offset = index * 4;
    const minimum = Math.min(data[offset], data[offset + 1], data[offset + 2]);
    const maximum = Math.max(data[offset], data[offset + 1], data[offset + 2]);
    if (minimum < 225 || maximum - minimum > 18) return;
    queue.push(index);
  };
  for (let x = 0; x < canvas.width; x += 1) {
    enqueue(x);
    const bottom = (canvas.height - 1) * canvas.width + x;
    enqueue(bottom);
  }
  for (let y = 0; y < canvas.height; y += 1) {
    const left = y * canvas.width;
    const right = left + canvas.width - 1;
    enqueue(left);
    enqueue(right);
  }
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const index = queue[cursor];
    data[index * 4 + 3] = 0;
    const x = index % canvas.width;
    const above = index - canvas.width;
    const below = index + canvas.width;
    enqueue(above);
    enqueue(below);
    if (x > 0) enqueue(index - 1);
    if (x + 1 < canvas.width) enqueue(index + 1);
  }
  context.putImageData(pixels, 0, 0);
  return canvas;
}

async function saveStrip(name, frames) {
  const strip = createCanvas(frameSize.width * frames.length, frameSize.height);
  const context = strip.getContext('2d');
  for (let index = 0; index < frames.length; index += 1) {
    const x = index * frameSize.width;
    context.drawImage(frames[index], x, 0);
  }
  const output = path.join(assetDirectory, `${name}.png`);
  const buffer = strip.toBuffer('image/png');
  const encoded = sharp(buffer);
  const rgba = encoded.ensureAlpha();
  const raw = rgba.raw();
  const pixels = await raw.toBuffer();
  for (let offset = 0; offset < pixels.length; offset += 4) {
    if (pixels[offset + 3] < 16) pixels[offset + 3] = 0;
    if (!name.startsWith('effect-') || pixels[offset + 3] === 0) continue;
    // Suppress low-alpha unpremultiplication noise introduced by raster resampling.
    pixels[offset] = Math.max(174, pixels[offset]);
    pixels[offset + 1] = Math.max(101, pixels[offset + 1]);
    pixels[offset + 2] = 255;
  }
  const rawOptions = { raw: { width: strip.width, height: strip.height, channels: 4 } };
  const finalImage = sharp(pixels, rawOptions);
  const finalPng = finalImage.png();
  const finalBytes = await finalPng.toBuffer();
  await writeFile(output, finalBytes);
  console.log(`${name}: ${frames.length} frames, ${strip.width} x ${strip.height}`);
}

function alignActorFeet(frame) {
  const context = frame.getContext('2d');
  const pixels = context.getImageData(0, 0, frame.width, frame.height);
  let sumX = 0;
  let count = 0;
  let footY = 0;
  for (let y = 126; y < 154; y += 1) {
    for (let x = 0; x < frame.width; x += 1) {
      const offset = (y * frame.width + x) * 4;
      const maximum = Math.max(pixels.data[offset], pixels.data[offset + 1], pixels.data[offset + 2]);
      if (pixels.data[offset + 3] < 180 || maximum > 100) continue;
      sumX += x;
      count += 1;
      footY = Math.max(footY, y);
    }
  }
  if (count === 0) return frame;
  const footX = sumX / count;
  const aligned = createCanvas(frame.width, frame.height);
  const target = aligned.getContext('2d');
  const offsetX = Math.round(120 - footX);
  const offsetY = 146 - footY;
  target.drawImage(frame, offsetX, offsetY);
  return aligned;
}

function actorFrame(atlas, cell) {
  const rectangle = { x: cell.column * atlas.width / 6, y: cell.row * atlas.height / 3, width: Math.floor(atlas.width / 6), height: Math.floor(atlas.height / 3) };
  if (cell.row === 1 && cell.column === 3) rectangle.width += 24;
  const cropped = crop(atlas, rectangle);
  const clean = removeBoundaryMatte(cropped);
  const cleanContext = clean.getContext('2d');
  const leftMargin = { x: 0, y: 0, width: 24, height: clean.height };
  const rightMargin = { x: clean.width - 18, y: 0, width: 18, height: clean.height };
  if (cell.row === 1 && cell.column === 4) cleanContext.clearRect(leftMargin.x, leftMargin.y, leftMargin.width, leftMargin.height);
  if (cell.row === 2 && cell.column === 4) cleanContext.clearRect(rightMargin.x, rightMargin.y, rightMargin.width, rightMargin.height);
  const scale = cell.row === 2 ? 0.64 : 0.57;
  const feet = cell.row === 0 ? 264 : cell.row === 1 ? 249 : 207;
  const frame = createCanvas(frameSize.width, frameSize.height);
  const context = frame.getContext('2d');
  context.translate(120 - 150 * scale, 148 - feet * scale);
  context.scale(scale, scale);
  context.drawImage(clean, 0, 0);
  return alignActorFeet(frame);
}

async function effectFrame(sheetBytes, rectangle) {
  const source = sharp(sheetBytes);
  const extraction = { left: rectangle.x, top: rectangle.y, width: rectangle.width, height: rectangle.height };
  const cropped = source.extract(extraction);
  const rgba = cropped.ensureAlpha();
  const raw = rgba.raw();
  const data = await raw.toBuffer();
  for (let offset = 0; offset < data.length; offset += 4) {
    const pixelIndex = offset / 4;
    const pixelX = pixelIndex % rectangle.width;
    const pixelY = Math.floor(pixelIndex / rectangle.width);
    const edgeDistance = Math.min(pixelX, rectangle.width - 1 - pixelX, pixelY, rectangle.height - 1 - pixelY);
    const edgeFade = Math.min(1, edgeDistance / 10);
    const sourceAlpha = data[offset + 3] / 255;
    const brightness = Math.min(data[offset], data[offset + 1], data[offset + 2]);
    const positive = Math.max(0, (brightness - 95) / 75);
    const alpha = Math.min(1, positive) * edgeFade * sourceAlpha;
    const positiveHighlight = Math.max(0, (brightness - 160) / 95);
    const highlight = Math.min(1, positiveHighlight);
    data[offset] = Math.round(174 + 81 * highlight);
    data[offset + 1] = Math.round(101 + 154 * highlight);
    data[offset + 2] = 255;
    data[offset + 3] = Math.round(alpha * 255);
  }
  const rawOptions = { raw: { width: rectangle.width, height: rectangle.height, channels: 4 } };
  const cleaned = sharp(data, rawOptions);
  const encoded = cleaned.png();
  const cleanBytes = await encoded.toBuffer();
  const canvas = await loadImage(cleanBytes);
  const frame = createCanvas(frameSize.width, frameSize.height);
  const target = frame.getContext('2d');
  const scale = 1.4;
  target.translate(120 - canvas.width * scale / 2, 80 - canvas.height * scale / 2);
  target.scale(scale, scale);
  target.drawImage(canvas, 0, 0);
  return frame;
}

async function main() {
  const atlasPath = path.join(assetDirectory, 'action-atlas-source.png');
  const sheetPath = path.join(assetDirectory, 'design-sheet-source.webp');
  const atlasBytes = await readFile(atlasPath);
  const sheetBytes = await readFile(sheetPath);
  const decodedAtlas = sharp(atlasBytes);
  const pngAtlas = decodedAtlas.png();
  const atlasPngBytes = await pngAtlas.toBuffer();
  const atlas = await loadImage(atlasPngBytes);
  const decodedSheet = sharp(sheetBytes);
  const pngSheet = decodedSheet.png();
  const pngBytes = await pngSheet.toBuffer();
  const actions = [
    { name: 'hero-attack-v2', row: 0, columns: [0, 1, 2, 3, 4, 5] },
    { name: 'hero-hit-v2', row: 1, columns: [0, 1, 2] },
    { name: 'hero-skill-v2', row: 1, columns: [4, 3, 4] },
    { name: 'hero-victory-v2', row: 2, columns: [0, 1, 3, 2, 4] },
  ];
  for (const action of actions) {
    const makeFrame = (column) => {
      const cell = { row: action.row, column };
      return actorFrame(atlas, cell);
    };
    const frames = action.columns.map(makeFrame);
    await saveStrip(action.name, frames);
  }
  const effects = [
    { name: 'effect-arc', top: 607, height: 66, ranges: [[439, 511], [512, 584], [586, 657], [658, 730]] },
    { name: 'effect-energy', top: 606, height: 68, ranges: [[743, 821], [824, 902], [909, 987], [991, 1075]] },
    { name: 'effect-impact', top: 739, height: 60, ranges: [[439, 512], [532, 611], [624, 710]] },
    { name: 'effect-shard', top: 858, height: 74, ranges: [[447, 491], [513, 561], [576, 632], [642, 706]] },
  ];
  for (const effect of effects) {
    const makeFrame = (range) => {
      const rectangle = { x: range[0], y: effect.top, width: range[1] - range[0], height: effect.height };
      return effectFrame(pngBytes, rectangle);
    };
    const framePromises = effect.ranges.map(makeFrame);
    const frames = await Promise.all(framePromises);
    await saveStrip(effect.name, frames);
  }
  const monsterActions = [
    { name: 'monster-idle-v2', source: 'monster-idle', columns: [0, 1, 2, 3] },
    { name: 'monster-hit-v2', source: 'monster-hit', columns: [0, 1, 0] },
    { name: 'monster-death-v2', source: 'monster-death', columns: [0, 1, 2, 3] },
  ];
  for (const action of monsterActions) {
    const sourcePath = path.join(assetDirectory, `${action.source}.png`);
    const sourceBytes = await readFile(sourcePath);
    const sourceImage = await loadImage(sourceBytes);
    const extractFrame = (column) => {
      const rectangle = { x: column * 240, y: 0, width: 240, height: 160 };
      const frame = crop(sourceImage, rectangle);
      const context = frame.getContext('2d');
      const pixels = context.getImageData(0, 0, frame.width, frame.height);
      for (let offset = 0; offset < pixels.data.length; offset += 4) {
        const original = pixels.data[offset + 3];
        const positive = Math.max(0, (original - 70) / 185);
        const alpha = Math.min(1, positive);
        pixels.data[offset + 3] = Math.round(alpha * 255);
      }
      context.putImageData(pixels, 0, 0);
      return frame;
    };
    const frames = action.columns.map(extractFrame);
    await saveStrip(action.name, frames);
  }
}

await main();
