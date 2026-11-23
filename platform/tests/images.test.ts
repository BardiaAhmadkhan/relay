import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { prepareImages } from '../server/images';
import { analyzePixels } from '../packages/core/quality';
describe('image boundary', () => {
  it('rejects corrupt and oversized decoded images', async () => {
    await expect(
      prepareImages([
        { id: 'x', view: 'front', base64: Buffer.from('not an image').toString('base64') },
      ]),
    ).rejects.toMatchObject({ code: 'invalid_image' });
    await expect(
      prepareImages([
        { id: 'x', view: 'front', base64: Buffer.alloc(4_200_001).toString('base64') },
      ]),
    ).rejects.toMatchObject({ code: 'image_too_large' });
  });
  it('normalizes orientation and strips EXIF including GPS, then rejects duplicate content', async () => {
    const source = await sharp({
      create: { width: 720, height: 960, channels: 3, background: '#667755' },
    })
      .withMetadata({
        orientation: 6,
        exif: {
          IFD0: { Artist: 'private owner' },
          IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '49/1 0/1 0/1' },
        },
      })
      .jpeg()
      .toBuffer();
    const input = { id: 'front1', view: 'front' as const, base64: source.toString('base64') };
    const result = await prepareImages([input]);
    const meta = await sharp(result.images[0]!.jpeg).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.width).toBe(960);
    expect(meta.height).toBe(720);
    await expect(
      prepareImages([input, { ...input, id: 'back1', view: 'back' }]),
    ).rejects.toMatchObject({ code: 'duplicate_photo' });
  });
  it('flags unusable dark/bright and low-resolution input without calling it damage', () => {
    const black = new Uint8Array(32 * 32 * 4);
    for (let i = 3; i < black.length; i += 4) black[i] = 255;
    const white = new Uint8Array(32 * 32 * 4).fill(255);
    expect(analyzePixels(black, 32, 32).warnings).toEqual(
      expect.arrayContaining(['dark', 'low_resolution']),
    );
    expect(analyzePixels(white, 32, 32).warnings).toContain('bright');
    expect(() => analyzePixels(black, 0, 0)).toThrow();
  });
});
