import fs from 'node:fs/promises';
import sharp from 'sharp';
import { z } from 'zod';
import { VERIFICATION_PROMPT } from '../packages/vision/verification-prompt';
const dir = 'benchmarks/phone-offline-02';
const output = dir + '/verifier-native-pixels-matrix.jsonl';
await fs.writeFile(output, '', { flag: 'wx' });
const protocol = JSON.parse(
  await fs.readFile('experiments/round-05/hard-case-protocol.json', 'utf8'),
);
const zone: Record<string, string> = {
  Shoulder: 'shoulder',
  Elbow: 'elbow',
  Forearm: 'forearm',
  'Upper sleeve': 'upper_arm',
  'Back panel': 'back',
  Chest: 'chest',
  Cuff: 'cuff',
};
const kind: Record<string, string> = {
  Abrasion: 'abrasion',
  'Torn material': 'tear',
  'Seam damage': 'seam',
};
const current = await fs.readFile('packages/mobile/inspection.ts', 'utf8');
const fixedInstruction = current.match(
  /'(You review untrusted candidate observations[^\n]+)Candidates: '/,
)![1];
const cases = [['biker-black--reference', 'release-control-findings']];
for (const [id, capture] of cases) {
  const c = protocol.cases.find((c: any) => c.id === id);
  const xml = await fs.readFile(dir + '/native/' + capture + '.xml', 'utf8');
  const texts = [...xml.matchAll(/\btext="([^"]+)"/g)].map((m) =>
    m[1]!.replaceAll('&amp;', '&').replaceAll('&quot;', '"'),
  );
  const findings = texts.flatMap((t, i) => {
    const parts = t.split(' / ');
    if (!zone[parts[0]!] || !kind[parts[1]!]) return [];
    return [
      {
        zone: zone[parts[0]!],
        kind: kind[parts[1]!],
        evidence: texts[i + 1],
        clarity: texts[i + 2]?.startsWith('Visible in photo') ? 'clear' : 'possible',
      },
    ];
  });
  if (findings.length !== 4) throw Error('Native candidate extraction failed: ' + id);
  const bytes = await fs.readFile(dir + '/native/control-prepared-android.jpg');
  const image = {
    type: 'image_url',
    image_url: { url: 'data:image/jpeg;base64,' + bytes.toString('base64') },
  };
  const slots = Object.fromEntries(
    findings.map((_, i) => ['candidate_' + i, z.enum(['supported', 'uncertain', 'unsupported'])]),
  );
  const fixedSchema = z.toJSONSchema(z.strictObject({ verdicts: z.strictObject(slots) }));
  const fixedCandidates =
    'Candidates: ' +
    JSON.stringify(Object.fromEntries(findings.map((f, i) => ['candidate_' + i, f])));
  const indices = findings.map((_, i) => i);
  const indexSchema = {
    type: 'object',
    properties: {
      supported: {
        type: 'array',
        items: { type: 'integer', enum: indices },
        maxItems: indices.length,
      },
      uncertain: {
        type: 'array',
        items: { type: 'integer', enum: indices },
        maxItems: indices.length,
      },
      crashPattern: {
        type: 'string',
        enum: ['consistent_with_sliding', 'not_observed', 'unclear'],
      },
    },
    required: ['supported', 'uncertain', 'crashPattern'],
    additionalProperties: false,
  };
  for (const variant of ['fixed-user', 'fixed-system', 'reference-system']) {
    const messages =
      variant === 'fixed-user'
        ? [
            {
              role: 'user',
              content: [image, { type: 'text', text: fixedInstruction + fixedCandidates }],
            },
          ]
        : [
            {
              role: 'system',
              content: variant === 'fixed-system' ? fixedInstruction : VERIFICATION_PROMPT,
            },
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text:
                    variant === 'fixed-system'
                      ? fixedCandidates
                      : 'Check these candidates (zero-based indices): ' +
                        JSON.stringify(findings.map((f, i) => ({ index: i, ...f }))),
                },
                image,
              ],
            },
          ];
    const started = performance.now();
    const response = await fetch('http://127.0.0.1:8792/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages,
        temperature: 0,
        seed: 42,
        max_tokens: 180,
        cache_prompt: false,
        chat_template_kwargs: { enable_thinking: false },
        response_format: {
          type: 'json_schema',
          json_schema: {
            strict: true,
            schema: variant === 'reference-system' ? indexSchema : fixedSchema,
          },
        },
      }),
      signal: AbortSignal.timeout(180000),
    });
    const raw: any = await response.json();
    const row = {
      id,
      variant,
      expectedDamage: c.expectedDamage,
      findings,
      ms: performance.now() - started,
      ok: response.ok,
      raw,
    };
    await fs.appendFile(output, JSON.stringify(row) + '\n');
    console.log(
      JSON.stringify({
        id,
        variant,
        ms: row.ms,
        result: raw.choices?.[0]?.message?.content,
        error: raw.error,
      }),
    );
  }
}
