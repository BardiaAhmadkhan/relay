import fs from 'node:fs';
import { readPublicVision } from './public-vision.mjs';
import path from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import sharp from 'sharp';
import { z } from 'zod';
import { header, buildDossier, type Dossier } from './dossier';
import { authentic, seal } from './seal';
import {
  emptyTerms,
  validateTerms,
  lotQuote,
  laneQuote,
  contribution,
  sizeKey,
  markets,
  type Market,
} from '../../packages/core/v4/commerce';
import { scopedService } from '../../packages/core/v4/fusion';
import { custodyCardCandidate } from '../../packages/core/v4/acquisition';
import { freshness } from './pack-status';
import { notebookItem } from './notebook';

const itemId = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const termSchema = z.strictObject({
  resaleRatio: z.number().min(0).max(1).nullable(),
  buyRate: z.number().min(0).max(1).nullable(),
  handlingMinor: z.number().int().min(0).nullable(),
  creditPremium: z.number().min(0).max(2).nullable(),
});
const scenarioType = z.enum(['actual', 'clear', 'custody_clear', 'crash']);
const country = z.enum(['CA', 'US', 'DE', 'PH', 'GB']);
const compare = (a: string, b: string) => {
  const left = Buffer.from(a),
    right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};
export function createDesk(cfg: {
  root: string;
  key: string;
  demo: boolean;
  operatorKey?: string;
  accessToken?: string;
  dbPath: string;
}) {
  if (cfg.key.length < 32) throw Error('A signing key is required');
  const root = path.resolve(cfg.root);
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(path.dirname(cfg.dbPath), { recursive: true });
  const db = new DatabaseSync(cfg.dbPath);
  db.exec(
    'PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=3000; CREATE TABLE IF NOT EXISTS desk_event (seq INTEGER PRIMARY KEY,id TEXT UNIQUE NOT NULL,kind TEXT NOT NULL,item TEXT NOT NULL,body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS native_photo(id TEXT PRIMARY KEY, case_id TEXT NOT NULL, sha TEXT NOT NULL, body TEXT NOT NULL)',
  );
  const sessions = new Map<string, { actor: string; expires: number; demo: boolean }>();
  const app = Fastify({ logger: false, bodyLimit: 10_000_000 });
  let running = false;
  app.register(cors, {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      try {
        const u = new URL(origin);
        cb(null, ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname));
      } catch {
        cb(null, false);
      }
    },
  });
  app.addHook('preHandler', async (q, reply) => {
    if (cfg.accessToken && !compare(String(q.headers['x-relay-token'] ?? ''), cfg.accessToken))
      return reply.code(401).send({ error: 'Access required.' });
  });
  app.addHook('onClose', async () => {
    db.close();
  });
  app.setErrorHandler((err: any, _q, reply) => {
    const code = err instanceof z.ZodError ? 422 : (err.statusCode ?? 500);
    reply.code(code).send({
      error: code >= 500 ? 'This check could not finish.' : (err.message ?? 'Invalid request'),
    });
  });
  const fail = (s: number, m: string) => Object.assign(new Error(m), { statusCode: s });
  const folder = (id: string) => path.join(root, itemId.parse(id));
  const read = <T>(f: string): T => JSON.parse(fs.readFileSync(f, 'utf8')) as T;
  const operator = (token: unknown) => {
    const a = sessions.get(String(token ?? ''));
    if (!a || a.expires < Date.now()) throw fail(403, 'Open a staff session first.');
    return a;
  };
  const base = (id: string) => {
    const f = path.join(folder(id), 'input.json');
    if (!fs.existsSync(f)) throw fail(404, 'This item has no completed inspection.');
    return header.parse(read(f));
  };
  const log = (kind: string, item: string, actor: string, payload: unknown) => {
    const id = randomBytes(16).toString('hex'),
      record = seal(
        'desk-event',
        { id, kind, item, actor, at: new Date().toISOString(), payload },
        cfg.key,
      );
    db.prepare('INSERT INTO desk_event (id,kind,item,body) VALUES (?,?,?,?)').run(
      id,
      kind,
      item,
      JSON.stringify(record),
    );
    return record;
  };
  const events = (kind: string, item: string) =>
    db
      .prepare('SELECT body FROM desk_event WHERE kind=? AND item=? ORDER BY seq')
      .all(kind, item)
      .map((x) => readEvent(String(x.body)));
  const readEvent = (text: string) => {
    const s = JSON.parse(text);
    if (!authentic(s, 'desk-event', cfg.key))
      throw fail(500, 'An event failed its integrity check.');
    return s;
  };
  const current = (id: string, scenario = 'actual'): Dossier => {
    const raw = base(id);
    const corrections = events('inspection_review', id);
    if (scenario !== 'actual') {
      if (!cfg.demo || !['clear', 'custody_clear', 'crash'].includes(scenario))
        throw fail(403, 'Scenario unavailable.');
      const b = read<any>(path.join(folder(id), 'foundation.json')).decisions[
        scenario === 'crash' ? 'declared_crash_scenario' : 'declared_clear_scenario'
      ];
      raw.combinedHistory = undefined;
      raw.history = scenario === 'crash' ? 'yes' : 'no';
      raw.damage = 'no';
      raw.repair = 'no';
      raw.foundation = b.outcome;
      raw.foundationReason = b.summary;
      raw.foundationGrade = b.grade;
    }
    const relevant = corrections.filter((e) => e.value.payload.scenario === scenario);
    const last = relevant.at(-1);
    const wear = events('wear', id)
      .filter((e) => e.value.payload.scenario === scenario)
      .at(-1);
    const custody = events('custody', id)
      .filter((e) => (e.value.payload.demo ? scenario === 'custody_clear' : scenario === 'actual'))
      .at(-1);
    const basisPath = path.join(folder(id), 'foundation.json'),
      basis = fs.existsSync(basisPath) ? read<any>(basisPath) : null;
    const firstHistory =
      raw.history === 'no' && raw.damage === 'no' && raw.repair === 'no'
        ? 'declared_clear_scenario'
        : raw.history === 'yes'
          ? 'declared_crash_scenario'
          : 'unreported';
    const premise =
      basis?.decisions?.[
        scenario === 'actual'
          ? firstHistory
          : scenario === 'crash'
            ? 'declared_crash_scenario'
            : 'declared_clear_scenario'
      ];
    const latestLink = events('identity_reconciliation', id)
      .filter((e) => (e.value.payload.demo ? scenario === 'custody_clear' : scenario === 'actual'))
      .at(-1);
    const opts = {
      staffInsideFront: custody?.value.payload.insideFront,
      wear: wear ? { photo: wear.value.payload.photo, zone: wear.value.payload.zone } : undefined,
      foundationEvidence:
        premise && Array.isArray(basis.slots)
          ? { decision: premise, slots: basis.slots }
          : undefined,
      staffResolvedMaker: latestLink?.value.payload.maker,
      verifiedCustody: custody?.sha256,
      confirmedFailure: relevant.some((e) => e.value.payload.kind === 'protective_failure'),
      confirmedRepair: relevant.some((e) => e.value.payload.kind === 'protective_repair'),
      reconciledAnchor: relevant.filter((e) => e.value.payload.kind === 'identity').at(-1)?.value
        .payload.anchor,
      specialistNote: last?.value.payload.note,
    };
    if (!relevant.length && !custody && !latestLink && !wear && scenario === 'actual') {
      const fp = path.join(folder(id), 'inspection.json');
      if (fs.existsSync(fp)) {
        const saved = read<Dossier>(fp);
        if (!authentic(saved, 'inspection', cfg.key))
          throw fail(500, 'Inspection signature failed.');
        if (saved.value.guidance?.disclosure && saved.value.result.primary) return saved;
      }
    }
    return buildDossier(raw, cfg.key, opts);
  };
  const termFor = (region: Market) => {
    const e = events('terms', region).at(-1);
    return {
      terms: e?.value.payload ?? emptyTerms,
      at: e?.value.at ?? null,
      actor: e?.value.actor ?? null,
      receipt: e?.sha256 ?? null,
    };
  };
  const allItems = () =>
    fs
      .readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory() && fs.existsSync(path.join(root, e.name, 'inspection.json')))
      .map((e) => e.name)
      .sort();
  app.get('/v4/presentation/vision', async () => {
    const source = path.resolve(process.env.RELAY_INSPECTION_VISION ?? 'docs/inspection-vision.md');
    if (!fs.existsSync(source)) throw fail(404, 'The presentation page is unavailable.');
    try {
      return { markdown: readPublicVision(source) };
    } catch {
      throw fail(503, 'The presentation copy is awaiting review.');
    }
  });
  app.get('/v4/health', async () => ({
    status: 'ok',
    version: '4.0',
    demo: cfg.demo,
    ready: allItems().length,
  }));
  app.get('/v4/items', async (q) => ({
    items: allItems().map((id) => {
      if ((q.query as { presentation?: string }).presentation === '1') {
        const rehearsal =
          cfg.demo && events('custody', id).some((e) => e.value.payload.demo === true);
        return notebookItem(current(id, rehearsal ? 'custody_clear' : 'actual').value, rehearsal);
      }
      const d = current(id).value;
      return {
        id,
        category: d.category,
        names: d.names,
        title: d.result.title,
        action: d.result.action,
        count: d.sourceCount,
      };
    }),
  }));
  app.get('/v4/items/:id', async (q) => {
    const { id } = q.params as any;
    const { scenario } = q.query as any;
    return current(id, scenario);
  });
  app.get('/v4/items/:id/photo/:hash', async (q, reply) => {
    const { id, hash } = q.params as any;
    const input = base(id);
    digest.parse(hash);
    if (!input.images.some((i) => i.workingHash === hash))
      throw fail(404, 'Photograph is unavailable.');
    const f = path.join(folder(id), 'photos', hash + '.jpg');
    if (!fs.existsSync(f)) throw fail(404, 'Photograph is unavailable.');
    const { rect, thumbnail } = q.query as { rect?: string; thumbnail?: string };
    if (!rect && thumbnail === '1') {
      const preview = await sharp(f)
        .rotate()
        .resize({ width: 320, height: 384, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 78 })
        .toBuffer();
      return reply
        .type('image/jpeg')
        .header('Cache-Control', 'private, max-age=1800')
        .send(preview);
    }
    if (!rect)
      return reply
        .type('image/jpeg')
        .header('Cache-Control', 'private, max-age=300')
        .send(fs.readFileSync(f));
    const dims = rect.split(',').map(Number);
    if (
      dims.length !== 4 ||
      dims.some((x) => !Number.isFinite(x) || x < 0 || x > 1) ||
      dims[2]! <= dims[0]! ||
      dims[3]! <= dims[1]!
    )
      throw fail(422, 'Invalid crop.');
    const meta = await sharp(f).metadata();
    const w = meta.width!,
      h = meta.height!;
    const l = Math.min(w - 1, Math.floor(w * dims[0]!)),
      t = Math.min(h - 1, Math.floor(h * dims[1]!));
    const crop = await sharp(f)
      .extract({
        left: l,
        top: t,
        width: Math.max(1, Math.min(w - l, Math.ceil(w * dims[2]!) - l)),
        height: Math.max(1, Math.min(h - t, Math.ceil(h * dims[3]!) - t)),
      })
      .jpeg()
      .toBuffer();
    return reply.type('image/jpeg').header('Cache-Control', 'private, max-age=300').send(crop);
  });
  app.post('/v4/staff/session', async (q) => {
    const b = z
      .strictObject({
        purpose: z.enum(['demo', 'staff']),
        name: z.string().trim().min(2).max(60),
        credential: z.string().max(256).optional(),
      })
      .parse(q.body);
    if (b.purpose === 'demo' && !cfg.demo) throw fail(403, 'This is not a demo workspace.');
    if (
      b.purpose === 'staff' &&
      (!cfg.operatorKey || !compare(b.credential ?? '', cfg.operatorKey))
    )
      throw fail(403, 'Staff sign-in is required.');
    const token = randomBytes(30).toString('base64url');
    sessions.set(token, {
      actor: (b.purpose === 'demo' ? 'Demo operator · ' : 'Staff · ') + b.name,
      expires: Date.now() + 60 * 60 * 1000,
      demo: b.purpose === 'demo',
    });
    return { token, demo: b.purpose === 'demo' };
  });
  app.post('/v4/staff/:id/custody', async (q) => {
    const a = operator(q.headers['x-relay-staff']);
    const { id } = q.params as any;
    const b = z
      .strictObject({
        card: digest,
        cardText: z.string().trim().min(1).max(80),
        acknowledge: z.literal(true),
        insideFront: digest.optional(),
        frontAttested: z.literal(true).optional(),
      })
      .parse(q.body);
    const i = base(id).images.find((f) => f.workingHash === b.card);
    if (!i || !custodyCardCandidate(i, id) || b.cardText.trim().toUpperCase() !== id.toUpperCase())
      throw fail(422, 'Choose the photographed item card and enter its visible ID.');
    if (
      b.insideFront &&
      (!b.frontAttested ||
        b.insideFront === b.card ||
        !base(id).images.some(
          (im) =>
            im.workingHash === b.insideFront &&
            ['inner_overview', 'inner_zone', 'pocket'].includes(im.role),
        ))
    )
      throw fail(
        422,
        'Choose a distinct interior photograph and attest its full front, hips and fly.',
      );
    const existing = events('custody', id).find(
      (e) =>
        e.value.payload.demo === a.demo &&
        e.value.payload.card === b.card &&
        (!b.insideFront || e.value.payload.insideFront === b.insideFront) &&
        String(e.value.payload.cardText).toUpperCase() === id.toUpperCase(),
    );
    return (
      existing ??
      log('custody', id, a.actor, {
        card: b.card,
        cardText: b.cardText,
        insideFront: b.insideFront ?? null,
        frontAttested: !!b.insideFront,
        assurance: 'Staff verified the photographed ID card and continuous item session.',
        demo: a.demo,
      })
    );
  });
  app.post('/v4/staff/:id/identity', async (q) => {
    const a = operator(q.headers['x-relay-staff']);
    const { id } = q.params as any;
    const b = z
      .strictObject({
        maker: z.string().trim().min(2).max(64),
        tag: digest,
        overview: digest,
        matchingLandmarks: z.string().trim().min(8).max(400),
      })
      .parse(q.body);
    if (b.tag === b.overview) throw fail(422, 'Choose two distinct connected views.');
    const d = current(id);
    if (!d.value.identity.conflicted || !d.value.identity.makers.includes(b.maker))
      throw fail(422, 'The selected maker is not one of the conflicting readings.');
    const im = base(id).images;
    const ref = im.find(
      (i) =>
        i.workingHash === b.overview &&
        ['outer_front', 'outer_back', 'outer_side', 'inner_overview', 'inner_zone'].includes(
          i.role,
        ),
    );
    const tag = im.find((i) => i.workingHash === b.tag && i.role === 'tag');
    if (
      !ref ||
      !tag ||
      !d.value.fields.some(
        (f) => f.photo === tag.photoId && f.field === 'brand' && f.value === b.maker,
      )
    )
      throw fail(422, 'Select the attached maker tag and a distinct garment-context view.');
    if (!events('custody', id).length)
      throw fail(422, 'Verify the item card before reconciling two separate photographs.');
    log('identity_reconciliation', id, a.actor, {
      ...b,
      method: 'Staff visually verified continuity with separate garment context',
      demo: a.demo,
    });
    return current(id, a.demo ? 'custody_clear' : 'actual');
  });
  app.post('/v4/staff/:id/review', async (q) => {
    const a = operator(q.headers['x-relay-staff']);
    const { id } = q.params as any;
    const b = z
      .strictObject({
        scenario: scenarioType,
        kind: z.enum(['observation', 'protective_failure', 'protective_repair', 'identity']),
        note: z.string().trim().min(5).max(450),
        source: digest,
        anchor: digest.optional(),
      })
      .parse(q.body);
    if (!a.demo && b.scenario !== 'actual') throw fail(422, 'Scenario mismatch.');
    const item = base(id);
    const hit = item.images.find((i) => i.workingHash === b.source);
    if (!hit) throw fail(422, 'Select evidence from this item.');
    if (
      b.kind === 'identity' &&
      (!b.anchor ||
        !item.images.some((i) => i.workingHash === b.anchor && i.attachment === 'same_frame'))
    )
      throw fail(422, 'A connected parent and label frame is required.');
    if (
      ['protective_failure', 'protective_repair'].includes(b.kind) &&
      !events('custody', id).some((e) =>
        e.value.payload.demo ? b.scenario === 'custody_clear' : b.scenario === 'actual',
      ) &&
      hit.attachment !== 'same_frame'
    )
      throw fail(422, 'Verify custody or supply connected evidence first.');
    log('inspection_review', id, a.actor, b);
    return current(id, b.scenario);
  });
  app.post('/v4/staff/:id/wear', async (q) => {
    const a = operator(q.headers['x-relay-staff']);
    const { id } = q.params as any;
    const b = z
      .strictObject({
        scenario: scenarioType,
        source: digest,
        zone: z.string().max(72),
        note: z.string().trim().min(8).max(450),
      })
      .parse(q.body);
    if (!a.demo && b.scenario !== 'actual') throw fail(422, 'Scenario mismatch.');
    const im = base(id).images.find((i) => i.workingHash === b.source);
    if (
      !im ||
      !im.regions.some((z) => z.zone === b.zone) ||
      (!events('custody', id).some((e) =>
        e.value.payload.demo ? b.scenario === 'custody_clear' : b.scenario === 'actual',
      ) &&
        im.attachment !== 'same_frame')
    )
      throw fail(422, 'Verify the item and select the visible area first.');
    log('wear', id, a.actor, { ...b, photo: im.photoId, demo: a.demo });
    return current(id, b.scenario);
  });
  app.get('/v4/shop/terms/:market', async (q) => termFor(country.parse((q.params as any).market)));
  app.post('/v4/shop/terms/:market', async (q) => {
    const a = operator(q.headers['x-relay-staff']),
      m = country.parse((q.params as any).market);
    const t = validateTerms(termSchema.parse(q.body));
    log('terms', m, a.actor, t);
    return termFor(m);
  });
  app.get('/v4/shop/:id', async (q) => {
    const { id } = q.params as any;
    const v = z
      .object({
        size: z.string().trim().min(1).max(30).optional(),
        market: country.default('CA'),
        scenario: scenarioType.default('actual'),
        weight: z.coerce.number().int().positive().max(100000).default(1000),
      })
      .parse(q.query);
    const d = current(id, v.scenario),
      terms = termFor(v.market);
    const latest = v.market === 'US' ? freshness('usps-ca') : null,
      knox = d.value.serviceCandidate ? freshness('knox-purchase') : null;
    const candidate = laneQuote(v.market, v.weight, v.market === 'CA' ? 'small' : undefined);
    const quote =
      latest && latest.status !== 'verified'
        ? {
            ...candidate,
            minor: null,
            basis: 'The US retail postal rule is awaiting verification.',
          }
        : candidate;
    const comparable = d.value.references.find(
      (x) => x.attribution === 'item-linked' && x.currency === quote.currency,
    );
    const margin = contribution({
      terms: terms.terms,
      priceMinor: comparable?.minor ?? null,
      currency: quote.currency,
      freightMinor: quote.minor,
      dutiesMinor: null,
      saleProbability: null,
      salvageMinor: null,
      acquisitionMinor: null,
    });
    const sizes = new Set(
      d.value.fields
        .filter((x) => x.field === 'size' && ['same_frame', 'custodial'].includes(x.attachment))
        .map((x) => sizeKey(x.value)),
    );
    if (v.size) {
      sizes.clear();
      sizes.add(sizeKey(v.size));
    }
    const matches = db
      .prepare("SELECT item,body FROM desk_event WHERE kind='stock_accept' ORDER BY seq DESC")
      .all()
      .map((e) => readEvent(String(e.body)))
      .filter((e) => {
        const s = e.value.payload;
        if (
          e.value.item === id ||
          s.scenario !== v.scenario ||
          !sizes.size ||
          !sizes.has(sizeKey(s.size)) ||
          s.category !== d.value.category
        )
          return false;
        const now = current(e.value.item, s.scenario);
        return now.sha256 === s.inspection && now.value.result.offerEligible;
      })
      .map((e) => ({
        item: e.value.item,
        size: e.value.payload.size,
        category: e.value.payload.category,
        receipt: e.sha256,
      }));
    return {
      inspection: d.sha256,
      market: markets[v.market],
      terms,
      comparable: d.value.references,
      route: quote,
      margin,
      eligible: d.value.result.offerEligible,
      freshness: {
        route: latest,
        component: knox,
        tariff: v.market === 'CA' ? freshness('ca-leather') : null,
      },
      componentResolvingSet:
        d.value.serviceCandidate && knox?.status === 'verified' ? ['verified_purchase_date'] : [],
      lifecycle: events('component_service', id)
        .filter((e) => e.value.payload.scenario === v.scenario)
        .map((e) => ({
          due: e.value.payload.dueDate,
          kind: 'Protector replacement reminder',
          receipt: e.sha256,
          source: e.value.payload.photo,
        })),
      service: d.value.serviceCandidate
        ? 'Knox recommends replacing the identified protector five years after purchase. Verify its model and purchase record.'
        : null,
      matches,
      philippines: {
        exact: lotQuote('PH', 10, 5000),
        withPackaging: lotQuote('PH', 10, 5500),
        action: 'Keep the lot at origin pending a firm resale and landed-cost quote.',
      },
    };
  });
  app.post('/v4/shop/:id/quote', async (q) => {
    const a = operator(q.headers['x-relay-staff']),
      id = (q.params as any).id;
    const money = z.number().int().min(0).max(100000000);
    const b = z
      .strictObject({
        scenario: scenarioType,
        inspection: digest,
        market: country,
        packedGrams: z.number().int().positive().max(30000),
        quantity: z.number().int().min(1).max(300),
        retailMinor: money.nullable(),
        dutiesMinor: money.nullable(),
        saleProbability: z.number().min(0).max(1).nullable(),
        salvageMinor: money.nullable(),
        acquisitionMinor: money.nullable(),
      })
      .parse(q.body);
    if (!a.demo && b.scenario !== 'actual')
      throw fail(403, 'Rehearsal input cannot create a live quote.');
    const d = current(id, b.scenario);
    if (d.sha256 !== b.inspection || !d.value.result.offerEligible)
      throw fail(409, 'A current eligible inspection is required for this quote.');
    const checked = b.market === 'US' ? freshness('usps-ca') : null;
    if (checked && checked.status !== 'verified')
      throw fail(409, 'This postal rule is awaiting verification.');
    const route = laneQuote(b.market, b.packedGrams, b.market === 'CA' ? 'small' : undefined),
      terms = termFor(b.market);
    const margin = contribution({
      priceMinor: b.retailMinor,
      currency: route.currency,
      terms: terms.terms,
      freightMinor: route.minor,
      dutiesMinor: b.dutiesMinor,
      saleProbability: b.saleProbability,
      salvageMinor: b.salvageMinor,
      acquisitionMinor: b.acquisitionMinor,
    });
    const quote = {
      ...b,
      packAnchor: checked?.anchor ?? null,
      packChecked: checked?.checked ?? null,
      currency: route.currency,
      perItemFreightMinor: route.minor,
      margin,
      termsReceipt: terms.receipt,
      origin: 'operator-entered quotation scenario',
      demo: a.demo,
    };
    const existing = events('commercial_quote', id).find(
      (e) => JSON.stringify(e.value.payload) === JSON.stringify(quote),
    );
    const proof = existing ?? log('commercial_quote', id, a.actor, quote);
    return {
      inspection: d.sha256,
      quoteReceipt: proof.sha256,
      margin,
      route,
      quantity: b.quantity,
    };
  });
  app.post('/v4/shop/:id/stock', async (q) => {
    const a = operator(q.headers['x-relay-staff']);
    const { id } = q.params as any;
    const b = z
      .strictObject({
        scenario: z.enum(['actual', 'clear', 'custody_clear']),
        inspection: digest,
        consignmentOrOwnership: z.literal(true),
        size: z.string().trim().min(1).max(30),
      })
      .parse(q.body);
    if (b.scenario !== 'actual' && !a.demo)
      throw fail(403, 'Demo assumption cannot create live stock.');
    const d = current(id, b.scenario);
    if (d.sha256 !== b.inspection || !d.value.result.offerEligible)
      throw fail(409, 'Staff acceptance requires a current eligible inspection.');
    const existing = events('stock_accept', id).find(
      (e) =>
        e.value.payload.scenario === b.scenario &&
        e.value.payload.inspection === d.sha256 &&
        sizeKey(e.value.payload.size) === sizeKey(b.size),
    );
    return (
      existing ??
      log('stock_accept', id, a.actor, { ...b, category: d.value.category, demo: a.demo })
    );
  });
  app.post('/v4/shop/:id/component-service', async (q) => {
    const a = operator(q.headers['x-relay-staff']),
      id = (q.params as any).id;
    const b = z
      .strictObject({
        scenario: scenarioType,
        photo: digest,
        purchaseDate: z.string(),
        componentVerified: z.literal(true),
      })
      .parse(q.body);
    if (!a.demo && b.scenario !== 'actual')
      throw fail(403, 'A rehearsal cannot create a live service record.');
    const item = current(id, b.scenario);
    const evidence = item.value.images.find((im) => im.hash === b.photo);
    if (
      !evidence ||
      !item.value.fields.some(
        (f) =>
          f.photo === evidence.id &&
          f.field === 'component_brand' &&
          f.value === 'KNOX' &&
          ['custodial', 'same_frame'].includes(f.attachment),
      )
    )
      throw fail(422, 'A bound Knox-specific tag and verified purchase are required.');
    const checked = freshness('knox-purchase');
    if (checked.status !== 'verified')
      throw fail(409, 'The maker interval is awaiting verification.');
    let service;
    try {
      service = scopedService({
        maker: 'KNOX',
        componentIdentified: true,
        purchaseDate: b.purchaseDate,
        asOf: new Date().toISOString().slice(0, 10),
      });
    } catch {
      throw fail(422, 'Enter a valid verified purchase date.');
    }
    if (!('dueDate' in service)) throw fail(422, 'The service interval could not be verified.');
    const existing = events('component_service', id).find(
      (e) =>
        e.value.payload.scenario === b.scenario &&
        e.value.payload.photo === b.photo &&
        e.value.payload.purchaseDate === b.purchaseDate,
    );
    const receipt =
      existing ??
      log('component_service', id, a.actor, {
        ...b,
        ...service,
        packAnchor: checked.anchor,
        packChecked: checked.checked,
        inspection: item.sha256,
        makerSource: 'https://www.planet-knox.com/maintain-motorcycle-body-armour-upgrades/',
        demo: a.demo,
      });
    return {
      status: service.status,
      dueDate: service.dueDate,
      receipt: receipt.sha256,
      inspection: item.sha256,
      reminder: { due: service.dueDate, scope: 'Knox protector only', notification: 'record only' },
    };
  });
  app.post('/v4/shop/component-service', async (q) => {
    const b = z
      .strictObject({
        maker: z.string().max(60),
        componentIdentified: z.boolean(),
        purchaseDate: z.string().optional(),
        asOf: z.string(),
      })
      .parse(q.body);
    return scopedService(b);
  });
  return { app, db, root, current, log, operator, allItems, folder, base, fail };
}
