/** A photo picker may omit the MIME type or return application/octet-stream. */
export function rasterMime(header: Uint8Array): string | undefined {
  const at = (i: number, ...bytes: number[]) =>
    bytes.every((byte, offset) => header[i + offset] === byte);
  const ascii = (start: number, length: number) =>
    String.fromCharCode(...header.subarray(start, start + length));
  if (at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') return 'image/webp';
  if (['GIF87a', 'GIF89a'].includes(ascii(0, 6))) return 'image/gif';
  if (ascii(0, 2) === 'BM') return 'image/bmp';
  if (at(0, 0x49, 0x49, 0x2a, 0) || at(0, 0x4d, 0x4d, 0, 0x2a)) return 'image/tiff';
  if (ascii(4, 4) === 'ftyp') {
    const brands = [ascii(8, 4)];
    for (let i = 16; i + 4 <= Math.min(header.length, 64); i += 4) brands.push(ascii(i, 4));
    if (brands.some((brand) => brand === 'avif' || brand === 'avis')) return 'image/avif';
    if (brands.some((brand) => ['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'].includes(brand)))
      return 'image/heif';
  }
}
