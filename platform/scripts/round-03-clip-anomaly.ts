import fs from 'node:fs/promises';
import sharp from 'sharp';
import {
  AutoModel,
  AutoProcessor,
  AutoTokenizer,
  RawImage,
  ZeroShotImageClassificationPipeline,
} from '@huggingface/transformers';
import { MODEL_SPECS } from '../packages/vision/local';
import { proposeRegions, regionImages } from '../packages/vision/regions';
const spec = MODEL_SPECS.local_clip,
  cache_dir = process.cwd() + '/.cache/models';
const [model, processor, tokenizer] = await Promise.all([
  AutoModel.from_pretrained(spec.model, {
    revision: spec.revision,
    cache_dir,
    dtype: 'q8',
    device: 'cpu',
    session_options: { intraOpNumThreads: 2, interOpNumThreads: 1 },
  }),
  AutoProcessor.from_pretrained(spec.model, { revision: spec.revision, cache_dir }),
  AutoTokenizer.from_pretrained(spec.tokenizer, { revision: spec.tokenizerRevision, cache_dir }),
]);
const classifier = new ZeroShotImageClassificationPipeline({
  task: 'zero-shot-image-classification',
  model,
  processor,
  tokenizer,
});
const labels = [
  'torn clothing with ragged holes, frayed fibers, and abrasion damage',
  'motorcycle clothing with scraped and abraded material from a crash',
  'intact clothing with normal stitching, zippers, and fabric texture',
  'worn leather with natural creases, patina, and decorative printed graphics',
  'a label, protective armor, or an unrelated object, without torn fabric',
];
const protocol = JSON.parse(
  await fs.readFile('experiments/round-03/condition-protocol.json', 'utf8'),
);
const rows = [];
for (const c of protocol.cases) {
  const start = performance.now();
  const jpg = await sharp(c.file).rotate().jpeg().toBuffer();
  const proposal = await proposeRegions(jpg);
  const crops = await regionImages(jpg, proposal.regions);
  const views = [];
  for (const [i, bytes] of [jpg, ...crops].entries()) {
    const { data, info } = await sharp(bytes)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const raw = new RawImage(new Uint8Array(data), info.width, info.height, 3);
    const scores = await classifier(raw, labels, { hypothesis_template: 'A photo of {}.' });
    views.push({ view: i === 0 ? 'whole' : 'region-' + i, scores });
  }
  const row = { id: c.id, ms: performance.now() - start, views };
  rows.push(row);
  console.log(JSON.stringify({ id: c.id, ms: row.ms, top: views.map((v) => v.scores[0]) }));
  await fs.writeFile(
    'benchmarks/round-03/clip-anomaly-probe.json',
    JSON.stringify(
      {
        spec,
        labels,
        scoreMeaning: 'Relative within this candidate set, not calibrated probability of damage.',
        rows,
      },
      null,
      2,
    ),
  );
}
await classifier.dispose();
