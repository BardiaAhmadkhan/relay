import fs from 'node:fs';
import { describe, it, expect } from 'vitest';
describe('native app metadata encoding', () => {
  it('uses the intended Unicode app names without encoding artifacts', () => {
    const config = JSON.parse(fs.readFileSync('app/app.json', 'utf8'));
    expect(config.expo.name).toBe('Relay · Gear Lab');
    expect(config.expo.web.name).toBe('Relay · Engineering Preview');
  });
});
