/** Inspect actual JPEG marker segments. Leave entropy-coded pixels byte-for-byte unchanged. */
export function stripMetadata(input: Uint8Array): Uint8Array {
  const maxBytes = 24 * 1024 * 1024;
  if (input.length < 8 || input.length > maxBytes || input[0] !== 0xff || input[1] !== 0xd8)
    throw Error('Choose a supported still JPEG');
  const pieces: Uint8Array[] = [input.subarray(0, 2)];
  let pos = 2,
    scan = false,
    sawScan = false,
    sawFrame = false,
    ended = false;
  while (pos < input.length) {
    if (scan) {
      const start = pos;
      while (pos < input.length) {
        if (input[pos] !== 0xff) {
          pos++;
          continue;
        }
        const markerStart = pos;
        while (input[pos] === 0xff && pos < input.length) pos++;
        const marker = input[pos];
        if (marker === undefined) throw Error('Truncated JPEG scan');
        if (marker === 0 || (marker >= 0xd0 && marker <= 0xd7)) {
          pos++;
          continue;
        }
        pos = markerStart;
        break;
      }
      pieces.push(input.subarray(start, pos));
      scan = false;
      if (pos === input.length) throw Error('Truncated JPEG');
    }
    const start = pos;
    if (input[pos++] !== 0xff) throw Error('Malformed JPEG marker');
    while (input[pos] === 0xff && pos < input.length) pos++;
    const marker = input[pos++];
    if (marker === undefined) throw Error('Truncated JPEG');
    if (marker === 0xd9) {
      if (!sawScan || !sawFrame) throw Error('No image scan');
      pieces.push(input.subarray(start, pos));
      ended = true;
      break;
    }
    if (marker === 0 || marker === 0xd8 || marker === 1 || (marker >= 0xd0 && marker <= 0xd7))
      throw Error('Unexpected JPEG marker');
    const hi = input[pos],
      lo = input[pos + 1];
    if (hi === undefined || lo === undefined) throw Error('Truncated JPEG segment');
    const count = (hi << 8) | lo;
    if (count < 2 || pos + count > input.length) throw Error('Invalid JPEG segment size');
    pos += count;
    const metadata = (marker >= 0xe0 && marker <= 0xef) || marker === 0xfe;
    if (!metadata) pieces.push(input.subarray(start, pos));
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) sawFrame = true;
    if (marker === 0xda) {
      sawScan = true;
      scan = true;
    }
  }
  if (!ended) throw Error('JPEG has no end marker');
  const bytes = new Uint8Array(pieces.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of pieces) {
    bytes.set(p, at);
    at += p.length;
  }
  return bytes;
}
