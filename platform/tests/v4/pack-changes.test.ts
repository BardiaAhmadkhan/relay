import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { freshness } from '../../server/v4/pack-status';
import { packImpact } from '../../packages/core/v4/pack-impact';
import { routedGarmentMaker } from '../../packages/core/v4/labels';
describe('pack changes remain local to their consumers', () => {
  it('distinguishes observed, stale and changed anchors without rewriting a rule', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-watch-test-'));
    try {
      const row = {
        anchorSha: 'a'.repeat(64),
        status: 'unchanged',
        checked: '2026-11-01T00:00:00Z',
        source: { freshDays: 30, url: 'https://example.test/', fact: 'rate' },
      };
      fs.writeFileSync(path.join(dir, 'baseline.json'), JSON.stringify({ 'usps-ca': row }));
      fs.writeFileSync(path.join(dir, 'latest-run.json'), JSON.stringify({ 'usps-ca': row }));
      expect(freshness('usps-ca', Date.parse('2026-11-15'), dir).status).toBe('verified');
      expect(freshness('usps-ca', Date.parse('2026-12-10'), dir).status).toBe('stale');
      fs.writeFileSync(
        path.join(dir, 'latest-run.json'),
        JSON.stringify({
          'usps-ca': {
            ...row,
            anchorSha: 'b'.repeat(64),
            status: 'anchor_changed_review_required',
          },
        }),
      );
      expect(freshness('usps-ca', Date.parse('2026-11-15'), dir).status).toBe('review_pending');
      expect(freshness('knox-purchase', Date.parse('2026-11-15'), dir).status).toBe('unverified');
    } finally {
      for (const file of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, file));
      fs.rmdirSync(dir);
    }
  });
  it('reprices only the affected concrete lane and band, preserves original inspection receipts, and keeps component clocks separate', () => {
    const cases = [
      {
        id: 'jeans',
        receipt: 'r',
        fields: [{ field: 'component_brand', value: 'KNOX', attachment: 'custodial' }],
      },
    ];
    const sample = {
      id: 'one',
      item: 'jeans',
      inspection: 'r',
      market: 'US',
      packedGrams: 1000,
      quantity: 2,
    };
    const result = packImpact(
      {
        key: 'US-to-CA-retail-postage',
        oldCents: [4355, 4705, 5045],
        newCents: [4355, 4705, 5095],
      },
      cases,
      [sample, { ...sample, id: 'two', market: 'CA' }],
      [],
    );
    expect(result.affectedQuotes).toHaveLength(1);
    expect(result.affectedQuotes[0]?.newCostMinor).toBe(10190);
    expect(result.originalReceipts).toEqual([{ item: 'jeans', receipt: 'r' }]);
    const clock = packImpact(
      { key: 'knox-purchase', oldYears: 5, newYears: 4 },
      cases,
      [sample],
      [{ item: 'jeans', receipt: 's', purchaseDate: '2020-02-29' }],
    );
    expect(clock.affectedQuotes).toHaveLength(0);
    expect(clock.affectedReminders[0]).toMatchObject({
      oldDue: '2025-02-28',
      newDue: '2024-02-29',
    });
  });
  it('accepts an explicitly printed unfamiliar maker but rejects component suppliers as garment makers', () => {
    expect(routedGarmentMaker('North Workshop')?.value).toBe('NORTH WORKSHOP');
    expect(routedGarmentMaker('Schoeller Dynatec')).toBeNull();
    expect(routedGarmentMaker('[illegible]')).toBeNull();
    expect(fs.readFileSync('server/v4/enrich.ts', 'utf8')).not.toContain('makerTask');
  });
});
