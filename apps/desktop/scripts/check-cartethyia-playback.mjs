import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

const scriptPath = fileURLToPath(import.meta.url);
const scriptDirectory = path.dirname(scriptPath);
const root = path.resolve(scriptDirectory, '../src/renderer/features/composer-modes/cartethyia-battle');
const outputDirectory = path.resolve(scriptDirectory, '../../../.cache/cartethyia-validation');
const browserPath = process.env.CARTETHYIA_BROWSER_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';

function assetUrl(name) {
  const assetPath = path.join(root, `assets/${name}.png`);
  const url = pathToFileURL(assetPath);
  return url.href;
}

function sprite(options) {
  const { name, frames, duration, role = '' } = options;
  const url = assetUrl(name);
  const style = `width:${frames * 120}px;height:80px;--cartethyia-once-travel:-${(frames - 1) * 120}px;--cartethyia-steps:${frames};--cartethyia-duration:${duration}ms`;
  return `<div class="cartethyia-battle__sprite-window ${role}"><img data-animation="${name}" class="cartethyia-battle__sprite-strip cartethyia-battle__sprite-strip--once" src="${url}" style="${style}"></div>`;
}

function scene(options) {
  const { width, cue, skill = false, hit = false } = options;
  const heroX = width / 2 - 87;
  const monsterX = heroX + 60;
  const heroName = cue === 'victory' ? 'hero-victory-v2' : cue === 'hero-return' ? 'hero-move' : skill ? 'hero-skill-v2' : 'hero-attack-v2';
  const frames = cue === 'victory' ? 5 : skill ? 3 : 6;
  const duration = cue === 'victory' ? 800 : skill ? 720 : 760;
  const hero = sprite({ name: heroName, frames, duration, role: 'cartethyia-battle__hero' });
  const monster = sprite({ name: hit ? 'monster-hit-v2' : 'monster-idle-v2', frames: hit ? 3 : 4, duration: hit ? 420 : 1080, role: 'cartethyia-battle__monster' });
  const slash = sprite({ name: 'effect-arc', frames: 4, duration: 300 });
  const impact = sprite({ name: 'effect-impact', frames: 3, duration: 300 });
  const energy = sprite({ name: 'effect-energy', frames: 4, duration: 360 });
  const ground = assetUrl('ground-platform-v2');
  const showMonster = cue !== 'victory' && cue !== 'hero-return';
  const effect = hit ? `<div class="cartethyia-battle__impact" data-hit-kind="${skill ? 'skill' : 'normal'}"><span class="cartethyia-battle__damage">−${skill ? 200 : 100}</span><div class="cartethyia-battle__slash-effect">${slash}</div><div class="cartethyia-battle__contact-effect">${impact}</div>${skill ? `<div class="cartethyia-battle__energy-effect">${energy}</div>` : ''}</div>` : '';
  const style = `--cartethyia-hero-start-x:18px;--cartethyia-hero-encounter-x:${heroX}px;--cartethyia-monster-encounter-x:${monsterX}px;--cartethyia-monster-spawn-x:${width - 138}px;--cartethyia-approach-duration:1000ms;--cartethyia-hero-return-duration:800ms;--cartethyia-ground-image:url('${ground}');--cartethyia-impact-x:${monsterX + 45}px;--cartethyia-damage-offset:0px;`;
  return `<p>${cue} · ${width}px${skill ? ' · skill' : ''}</p><div class="cartethyia-battle" data-battle-cue="${cue}" style="width:${width}px"><div class="cartethyia-battle__arena" style="${style}"><div class="cartethyia-battle__ground"></div><div class="cartethyia-battle__actor cartethyia-battle__hero-actor">${hero}</div>${showMonster ? `<div class="cartethyia-battle__actor cartethyia-battle__monster-actor">${monster}</div>` : ''}${effect}</div></div>`;
}

async function main() {
  await mkdir(outputDirectory, { recursive: true });
  const cssPath = path.join(root, 'cartethyia-battle.css');
  const css = await readFile(cssPath, 'utf8');
  const rows = [
    { width: 460, cue: 'hero-attack', hit: true },
    { width: 460, cue: 'skill', hit: true, skill: true },
    { width: 460, cue: 'victory' },
    { width: 460, cue: 'hero-return' },
    { width: 320, cue: 'hero-attack', hit: true },
    { width: 900, cue: 'hero-attack', hit: true },
  ];
  const scenes = rows.map(scene);
  const body = scenes.join('');
  const html = `<!doctype html><meta charset="utf-8"><style>${css}body{margin:20px;background:var(--surface);color:var(--text-primary);font-family:Arial}p{font-size:13px;margin:12px 0 6px}:root{--cartethyia-damage-color:#D5A9FF;--cartethyia-damage-outline:#30204F;--cartethyia-skill-damage-color:#F0DFFF}</style>${body}`;
  const htmlPath = path.join(outputDirectory, 'preview.html');
  await writeFile(htmlPath, html);
  const browser = await chromium.launch({ executablePath: browserPath, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 950, height: 700 }, deviceScaleFactor: 2 });
    const url = pathToFileURL(htmlPath);
    await page.goto(url.href);
    const sampleFrames = () => {
      const strip = document.querySelector('[data-animation="hero-attack-v2"]');
      const animations = strip.getAnimations();
      const animation = animations[0];
      animation.pause();
      const sample = (time) => {
        animation.currentTime = time;
        const style = getComputedStyle(strip);
        const matrix = new DOMMatrixReadOnly(style.transform);
        const offset = Math.round(-matrix.m41 / 120);
        return { time, frame: offset + 1 };
      };
      const samples = [0, 126, 128, 379, 381, 633, 635, 700, 759, 760].map(sample);
      return samples;
    };
    const samples = await page.evaluate(sampleFrames);
    const actual = samples.map((sample) => sample.frame);
    const expected = [1, 1, 2, 3, 4, 5, 6, 6, 6, 6];
    assert.deepEqual(actual, expected);
    console.log('All attack frames, including the final frame, hold for their full interval:', samples);
    for (const mode of ['light', 'dark']) {
      const freeze = (theme) => {
        const surface = theme === 'light' ? '#f8f8f6' : '#1f1f1e';
        const text = theme === 'light' ? '#262626' : '#d4d4d4';
        document.body.style.setProperty('--surface', surface);
        document.body.style.setProperty('--text-primary', text);
        const animations = document.getAnimations();
        for (const animation of animations) {
          animation.pause();
          const target = animation.effect.target;
          const isEffect = target.closest('.cartethyia-battle__impact');
          animation.currentTime = isEffect ? 140 : 410;
        }
      };
      await page.evaluate(freeze, mode);
      const screenshot = path.join(outputDirectory, `preview-${mode}.png`);
      await page.screenshot({ path: screenshot, fullPage: true });
      console.log(screenshot);
    }
  } finally {
    await browser.close();
  }
}

await main();
