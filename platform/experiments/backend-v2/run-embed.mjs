// Image embeddings + zero-shot text scores from the already-cached pretrained encoders (CPU, no training).
// node experiments/backend-v2/run-embed.mjs --kind siglip|clip
import path from 'node:path';
import fs from 'node:fs/promises';
import { AutoModel, AutoProcessor, AutoTokenizer, RawImage } from '@huggingface/transformers';
import sharp from 'sharp';
import { OUT, ROOT, loadCases, args } from './lib.mjs';

const a = args();
const kind = a.kind ?? 'siglip';
const spec = {
  siglip: {
    model: 'onnx-community/siglip-base-patch16-224-ONNX',
    revision: '9f0328bdd0eb4f62d0f6c10625f43d882b32102b',
    tokenizer: 'google/siglip-base-patch16-224',
    tokenizerRevision: '7fd15f0689c79d79e38b1c2e2e2370a7bf2761ed',
    padding: 'max_length',
  },
  clip: {
    model: 'Xenova/clip-vit-base-patch32',
    revision: 'd15189d7028b43f1d3e65039190477f6af591c2a',
    tokenizer: 'Xenova/clip-vit-base-patch32',
    tokenizerRevision: 'd15189d7028b43f1d3e65039190477f6af591c2a',
    padding: true,
  },
}[kind];
const cache_dir = path.join(ROOT, '.cache', 'models');
const [model, tokenizer, processor] = await Promise.all([
  AutoModel.from_pretrained(spec.model, {
    revision: spec.revision,
    cache_dir,
    dtype: 'q8',
    device: 'cpu',
    session_options: { intraOpNumThreads: 6, interOpNumThreads: 1 },
  }),
  AutoTokenizer.from_pretrained(spec.tokenizer, { revision: spec.tokenizerRevision, cache_dir }),
  AutoProcessor.from_pretrained(spec.model, { revision: spec.revision, cache_dir }),
]);
// Frozen zero-shot text set: index 0..2 damaged wording, 3..5 intact wording.
const texts = [
  'a photo of torn, ripped or holed material',
  'a photo of crash damaged motorcycle gear with scraped and torn fabric',
  'a close-up photo of a hole or tear in fabric',
  'a photo of intact material in good condition',
  'a photo of undamaged motorcycle gear',
  'a close-up photo of clean intact fabric',
];
const textInputs = tokenizer(texts, { padding: spec.padding, truncation: true });
const cases = await loadCases();
const rows = [];
const started = performance.now();
for (const c of cases) {
  const png = await sharp(path.join(ROOT, c.file)).rotate().flatten({ background: '#ffffff' }).png().toBuffer();
  const image = await RawImage.fromBlob(new Blob([png]));
  const imageInputs = await processor(image);
  const t0 = performance.now();
  const out = await model({ ...textInputs, ...imageInputs });
  const ms = performance.now() - t0;
  const emb = Array.from(out.image_embeds.data);
  const norm = Math.hypot(...emb);
  const logits = Array.from(out.logits_per_image.data);
  rows.push({
    id: c.id,
    corpus: c.corpus,
    domain: c.domain,
    group: c.group,
    condition: c.condition,
    ms: Math.round(ms),
    logits: logits.map((v) => +v.toFixed(4)),
    embedding: emb.map((v) => +(v / norm).toFixed(5)),
  });
  if (rows.length % 50 === 0) console.log(rows.length + '/' + cases.length);
}
await fs.mkdir(OUT, { recursive: true });
const file = path.join(OUT, 'embed--' + kind + '.json');
await fs.writeFile(file, JSON.stringify({ kind, spec, texts, totalMs: Math.round(performance.now() - started), rows }));
console.log('done', file);
