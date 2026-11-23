/** Static shell of the expert console (work package 12). Functional, not designed: the competition
 * build should restyle it in the app's design language. It holds no data; the script fetches items
 * with the access token the expert types in. All dynamic text is set with textContent. */
export const REVIEW_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Relay specialist review</title>
<style>
  :root { color-scheme: light dark; --line: #8884; --muted: #777; --accent: #2f6f4f; --warn: #a33; }
  body { font: 15px/1.45 system-ui, sans-serif; margin: 0 auto; max-width: 1100px; padding: 16px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .muted { color: var(--muted); }
  .card { border: 1px solid var(--line); border-radius: 10px; padding: 14px; margin: 14px 0; }
  .photos { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 12px; }
  .photo img { width: 100%; border-radius: 6px; background: #8882; aspect-ratio: 4 / 3; object-fit: contain; }
  .located { position: relative; line-height: 0; } .located img { display: block; aspect-ratio: auto; height: auto; } .locator { position: absolute; border: 2px solid white; outline: 1px solid #18261c; box-sizing: border-box; pointer-events: none; }
  fieldset { border: 0; padding: 0; margin: 6px 0; }
  legend { font-weight: 600; font-size: 13px; }
  label { margin-right: 10px; white-space: nowrap; }
  .model { display: none; border-top: 1px dashed var(--line); margin-top: 10px; padding-top: 10px; }
  .model.shown { display: block; }
  .bar { position: relative; height: 10px; background: #8883; border-radius: 5px; margin: 2px 0 8px; }
  .bar span { position: absolute; top: 0; bottom: 0; left: 0; background: var(--accent); border-radius: 5px; }
  .bar i { position: absolute; top: -3px; bottom: -3px; width: 2px; background: currentColor; }
  .verdict { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 10px; }
  button { font: inherit; padding: 6px 12px; border-radius: 6px; border: 1px solid var(--line); cursor: pointer; }
  button[disabled] { opacity: .5; cursor: default; }
  .error { color: var(--warn); }
  .saved { color: var(--accent); font-weight: 600; }
</style>
</head>
<body>
<h1>Specialist review</h1>
<p class="muted">Mark every photograph from what you see first. The model's assessment is revealed after that, so your marks stay your own: they become the examples the next calibration learns its thresholds from.</p>
<form id="login">
  <label>Access token <input id="token" type="password" autocomplete="off" required></label>
  <label>Your name <input id="reviewer" maxlength="40" required></label>
  <button type="submit">Open the queue</button>
</form>
<p id="status" class="muted" role="status"></p>
<main id="items"></main>
<script src="/v2/review/console.js"></script>
</body>
</html>
`;

export const REVIEW_SCRIPT = `'use strict';
const $ = (tag, attrs = {}, text) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (text !== undefined) el.textContent = text;
  return el;
};
const store = { get: (k) => { try { return sessionStorage.getItem(k) || ''; } catch { return ''; } },
  set: (k, v) => { try { sessionStorage.setItem(k, v); } catch {} } };
const status = document.getElementById('status');
const tokenInput = document.getElementById('token'), reviewerInput = document.getElementById('reviewer');
tokenInput.value = store.get('relay.review.token');
reviewerInput.value = store.get('relay.review.reviewer');
const headers = () => ({ 'X-Relay-Token': tokenInput.value, 'Content-Type': 'application/json' });
const QUESTION = { broken: 'Broken material', road_contact: 'Road-contact damage', repair: 'Repair' };
const HISTORY = { crash: 'Crash', protective_damage: 'Protective-area damage', protective_repair: 'Protective-area repair' };
async function load() {
  status.textContent = 'Loading…';
  const r = await fetch('/v2/review/items', { headers: headers() });
  if (!r.ok) { status.textContent = r.status === 401 ? 'Check the access token.' : 'The queue could not be loaded.'; return; }
  const data = await r.json();
  const main = document.getElementById('items');
  main.replaceChildren();
  status.textContent = data.items.length ? data.items.length + ' waiting or decided · thresholds ' + data.thresholdsVersion : 'Nothing is waiting.';
  for (const item of data.items) main.append(await card(item));
}
async function card(item) {
  const box = $('section', { class: 'card', 'aria-label': 'Assessment ' + item.assessmentId });
  box.append($('h2', {}, 'Item ' + item.assessmentId.slice(0, 8)));
  box.append($('p', { class: 'muted' }, 'Received ' + new Date(item.receivedAt).toLocaleTimeString()));
  const hist = $('p');
  hist.textContent = 'Rider history: ' + item.history.map((h) => HISTORY[h.question] + ' ' + h.answer + (h.everYes ? ' (yes was given)' : '')).join(' · ');
  box.append(hist);
  const photos = $('div', { class: 'photos' });
  const marks = {};
  for (const p of item.photos) {
    const fig = $('figure', { class: 'photo' });
    const img = $('img', { alt: p.view + ' photograph' });
    const r = await fetch('/v2/review/items/' + encodeURIComponent(item.assessmentId) + '/photos/' + encodeURIComponent(p.id), { headers: headers() });
    if (r.ok) img.src = URL.createObjectURL(await r.blob());
    let visual = img;
    const linked = item.photos.filter((child) => child.fromOverview && child.fromOverview.parentId === p.id);
    if (linked.length) {
      visual = $('div', { class: 'located' }); visual.append(img);
      for (const child of linked) {
        const m = child.fromOverview;
        const r = $('span', { class: 'locator', role: 'img', 'aria-label': 'Location of rider-marked detail' });
        Object.assign(r.style, { left: 100*m.left/m.sourceWidth+'%', top: 100*m.top/m.sourceHeight+'%', width: 100*m.side/m.sourceWidth+'%', height: 100*m.side/m.sourceHeight+'%' });
        visual.append(r);
      }
    }
    fig.append(visual, $('figcaption', {}, (p.fromOverview ? 'Rider-marked crop of ' + p.fromOverview.parentView + ' · ' + p.fromOverview.side + ' source pixels per side' : p.view) + (p.quality.warnings.length ? ' · ' + p.quality.warnings.join(', ') : '')));
    marks[p.id] = {};
    for (const [key, legend] of [['damaged', 'Broken material or road-contact damage'], ['repair', 'A repair']]) {
      const set = $('fieldset');
      set.append($('legend', {}, legend));
      for (const value of ['yes', 'no', 'unsure']) {
        const lab = $('label');
        const input = $('input', { type: 'radio', name: item.assessmentId + p.id + key, value });
        input.addEventListener('change', () => { marks[p.id][key] = value; update(); });
        lab.append(input, document.createTextNode(' ' + value));
        set.append(lab);
      }
      fig.append(set);
    }
    const model = $('div', { class: 'model' });
    for (const q of ['broken', 'road_contact', 'repair']) {
      const a = p.answers[q];
      if (!a || a.type !== 'yesno') continue;
      const band = q === 'repair' ? p.bands && p.bands.repair : p.bands && p.bands.damage;
      model.append($('div', {}, QUESTION[q] + ': ' + a.p.toFixed(2)));
      const bar = $('div', { class: 'bar', role: 'img', 'aria-label': QUESTION[q] + ' score ' + a.p.toFixed(2) });
      const fill = $('span'); fill.style.width = (a.p * 100).toFixed(1) + '%'; bar.append(fill);
      if (band) for (const t of [band.clear, band.block]) { const tick = $('i'); tick.style.left = (t * 100).toFixed(1) + '%'; bar.append(tick); }
      model.append(bar);
    }
    model.append($('div', { class: 'muted' }, p.scorer.id + ' · ' + p.scorer.model));
    fig.append(model);
    photos.append(fig);
  }
  box.append(photos);
  const reveal = $('button', { type: 'button', disabled: '' }, 'Show the model\\'s assessment');
  const modelText = $('div', { class: 'model' });
  modelText.append($('p', {}, 'Model: ' + item.decision.title + '. ' + item.decision.summary));
  const reasons = $('ul');
  for (const r of item.decision.reasons) reasons.append($('li', {}, r.text));
  modelText.append(reasons);
  reveal.addEventListener('click', () => box.querySelectorAll('.model').forEach((m) => m.classList.add('shown')));
  box.append(reveal, modelText);
  const verdict = $('div', { class: 'verdict' });
  const grade = $('select', { 'aria-label': 'Condition grade' });
  for (const g of ['', 'A', 'B', 'C', 'D']) grade.append($('option', { value: g }, g || 'Grade'));
  const note = $('input', { 'aria-label': 'Note', placeholder: 'Note (needed when offering despite a mark)', maxlength: '300', size: '36' });
  const result = $('span', { role: 'status' });
  const buttons = [['offer', 'Offer'], ['no_offer', 'No offer'], ['more_photos', 'Need another photo']].map(([outcome, label]) => {
    const b = $('button', { type: 'button', disabled: '' }, label);
    b.addEventListener('click', () => save(item, outcome, grade.value || null, note.value, marks, result));
    return b;
  });
  verdict.append(grade, note, ...buttons, result);
  box.append(verdict);
  function update() {
    const complete = item.photos.every((p) => marks[p.id].damaged && marks[p.id].repair);
    reveal.disabled = !complete;
    for (const b of buttons) b.disabled = !complete;
  }
  if (item.verdict) result.append($('span', { class: 'saved' }, 'Saved: ' + item.verdict.outcome + ' by ' + item.verdict.reviewer));
  return box;
}
async function save(item, outcome, grade, note, marks, result) {
  result.textContent = 'Saving…';
  const r = await fetch('/v2/review/items/' + encodeURIComponent(item.assessmentId) + '/verdict', {
    method: 'POST', headers: headers(),
    body: JSON.stringify({ outcome, grade, note, reviewer: reviewerInput.value, photos: marks }),
  });
  const body = await r.json().catch(() => null);
  result.className = r.ok ? 'saved' : 'error';
  result.textContent = r.ok ? 'Saved: ' + outcome : (body && body.error && body.error.message) || 'Not saved.';
}
document.getElementById('login').addEventListener('submit', (e) => {
  e.preventDefault();
  store.set('relay.review.token', tokenInput.value);
  store.set('relay.review.reviewer', reviewerInput.value);
  load().catch(() => { status.textContent = 'The queue could not be loaded.'; });
});
if (tokenInput.value) load().catch(() => {});
`;
