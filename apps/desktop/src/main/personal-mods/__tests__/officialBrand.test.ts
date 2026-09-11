import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { BRAND_NAME } from '@cindy/maker-shared/branding';
import expected from './fixtures/official-brand-assets.json';

describe('official branding beneath optional Mods', () => {
  it('keeps the application identity and base artwork independent of Cartethyia', () => {
    expect(BRAND_NAME).toBe('Cindy');
    const root = path.resolve(__dirname, '../../../../../..');
    for (const [relative, digest] of Object.entries(expected)) {
      const file = path.join(root, relative);
      const bytes = fs.readFileSync(file);
      const hash = createHash('sha256');
      hash.update(bytes);
      const actual = hash.digest('hex');
      expect(actual, relative).toBe(digest);
    }
  });
});
