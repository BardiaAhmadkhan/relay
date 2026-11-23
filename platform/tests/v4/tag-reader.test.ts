import { test, expect } from 'vitest';
import sharp from 'sharp';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { provisionAllocation } from '../../server/count-budget';
import { tagReader, extractionTask } from '../../server/v4/tag-reader';
test('specialist label reader reserves first, sends only stripped evidence and falls back when blocked', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'relay-v4-tag-'));
  const file = path.join(dir, 'study.sqlite');
  try {
    provisionAllocation(file, { scope: 'unit', micros: 35000000 });
    const db = new DatabaseSync(file);
    db.exec(
      'CREATE TABLE count_attempt(day TEXT,ticket TEXT PRIMARY KEY,digest TEXT,model TEXT,protocol TEXT,reserved INTEGER,started_ms INTEGER,state TEXT,label TEXT,request_id TEXT,elapsed_ms INTEGER,charged_micros INTEGER,input_tokens INTEGER,output_tokens INTEGER)',
    );
    const env: NodeJS.ProcessEnv = {
      NODE_ENV: 'test',
      OPENAI_API_KEY: 'fixture',
      RELAY_SIGNING_KEY: 'S'.repeat(40),
      RELAY_R2_LEDGER: file,
      RELAY_R2_BUDGET_SCOPE: 'unit',
      RELAY_R2_LIFETIME_USD: '35',
      RELAY_R2_DAILY_USD: '6',
      RELAY_R2_DAILY_CALLS: '300',
      RELAY_ALLOW_PAID: '1',
      RELAY_R2_TERMS_COVERED: '1',
    };
    const img = await sharp({ create: { width: 36, height: 44, channels: 3, background: 'red' } })
      .jpeg()
      .toBuffer();
    let network = 0;
    const mock: typeof fetch = async (url, opts) => {
      network++;
      expect(
        db.prepare("select count(*) as n from count_attempt where state='reserved'").get()?.n,
      ).toBe(1);
      const body = JSON.parse(String(opts?.body));
      expect(JSON.stringify(body)).not.toContain('commerce');
      if (String(url).endsWith('/input_tokens'))
        return Response.json({ object: 'response.input_tokens', input_tokens: 500 });
      expect(body.store).toBe(false);
      expect(body.max_output_tokens).toBe(600);
      return Response.json({
        model: 'gpt-6.2-sol',
        service_tier: 'default',
        usage: { input_tokens: 500, output_tokens: 50 },
        status: 'completed',
        output: [
          {
            role: 'assistant',
            type: 'message',
            content: [{ type: 'output_text', text: '{"lines":["CE AA EN 17092-3:2020"]}' }],
          },
        ],
      });
    };
    const reader = tagReader(env, mock)!;
    expect((await reader.read('other' as typeof extractionTask, img, 'reason')).status).toBe(
      'confirm',
    );
    expect(network).toBe(0);
    expect((await reader.read(extractionTask, img, 'measurement')).text).toContain('AA');
    expect((await reader.read(extractionTask, img, 'measurement')).status).toBe(
      'already_recorded_or_budget',
    );
    db.prepare('UPDATE count_attempt SET charged_micros=999999').run();
    const second = await sharp({
      create: { width: 36, height: 44, channels: 3, background: 'blue' },
    })
      .jpeg()
      .toBuffer();
    expect((await reader.read(extractionTask, second, 'measurement')).status).toBe(
      'already_recorded_or_budget',
    );
    expect(network).toBe(2);
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
