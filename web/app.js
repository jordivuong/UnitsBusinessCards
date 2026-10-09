const $ = (s, r = document) => r.querySelector(s);
let templates = [];

async function api(path, opts) {
  const r = await fetch(path, opts);
  if (r.status === 401 && path !== '/api/login') { showLogin(); throw new Error('Veuillez vous connecter.'); }
  const body = r.headers.get('content-type')?.includes('json') ? await r.json() : null;
  if (!r.ok) throw new Error(body?.error || 'Erreur inattendue.');
  return body;
}

function showLogin() {
  $('#login').hidden = false; $('#app').hidden = true; $('#who').hidden = true;
}
async function showApp(email) {
  $('#login').hidden = true; $('#app').hidden = false; $('#who').hidden = false;
  $('#whoEmail').textContent = email;
  templates = await api('/api/templates');
  const sel = $('#template');
  sel.replaceChildren(...templates.map((t) => Object.assign(document.createElement('option'), { value: t.id, textContent: `${t.name} (${t.trim.w} × ${t.trim.h} mm)` })));
  onTemplate();
}
function onTemplate() {
  const t = templates.find((x) => x.id === $('#template').value);
  if (!t) return;
  $('#columns').textContent = t.fields.map((f) => f.label + (f.optional ? ' (facultatif)' : '')).join(', ');
  $('#sample').href = `/api/templates/${t.id}/exemple.csv`;
  buildManual(t);
}
const mode = () => document.querySelector('[name=mode]:checked').value;
function buildManual(t) {
  $('#modeManual').replaceChildren(...t.fields.map((f) => {
    const input = Object.assign(document.createElement('input'), { type: 'text', name: f.name, required: !f.optional, maxLength: 200 });
    const label = document.createElement('label');
    label.append(f.label + (f.optional ? ' (facultatif)' : ''), input);
    return label;
  }));
}
function onMode() {
  const manual = mode() === 'manual';
  $('#modeCsv').hidden = manual; $('#modeManual').hidden = !manual;
  $('#csv').required = !manual;
  for (const i of $('#modeManual').querySelectorAll('input')) i.disabled = !manual;
}
for (const r of document.querySelectorAll('[name=mode]')) r.addEventListener('change', onMode);
const csvCell = (v) => `"${String(v).replace(/"/g, '""')}"`;
function manualCsv() {
  const t = templates.find((x) => x.id === $('#template').value);
  const vals = t.fields.map((f) => $('#modeManual').querySelector(`[name="${f.name}"]`).value.trim());
  return new Blob(['\uFEFF', t.fields.map((f) => csvCell(f.label)).join(';'), '\r\n', vals.map(csvCell).join(';'), '\r\n'], { type: 'text/csv' });
}

$('#template').addEventListener('change', onTemplate);
$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#loginError').textContent = '';
  try {
    const d = Object.fromEntries(new FormData(e.target));
    const me = await api('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(d) });
    e.target.reset();
    await showApp(me.email);
  } catch (err) { $('#loginError').textContent = err.message; }
});
$('#logout').addEventListener('click', async () => { await api('/api/logout', { method: 'POST' }); $('#results').hidden = true; showLogin(); });

$('#jobForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#jobError').textContent = '';
  const fd = new FormData();
  fd.append('templateId', $('#template').value);
  fd.append('marks', $('#marks').checked ? '1' : '0');
  if (mode() === 'manual') fd.append('csv', manualCsv(), 'carte.csv');
  else fd.append('csv', $('#csv').files[0]);
  $('#go').disabled = true; $('#busy').hidden = false;
  try {
    render(await api('/api/jobs', { method: 'POST', body: fd }));
  } catch (err) { $('#jobError').textContent = err.message; }
  finally { $('#go').disabled = false; $('#busy').hidden = true; }
});

function render(job) {
  $('#results').hidden = false;
  $('#testProfile').hidden = !job.testProfile;
  const failed = $('#failed');
  failed.replaceChildren();
  if (job.failed.length) {
    const box = Object.assign(document.createElement('div'), { className: 'failed' });
    box.append(`${job.failed.length} ligne(s) du CSV n'ont pas pu être générées (non incluses dans le ZIP) :`);
    const ul = document.createElement('ul');
    for (const f of job.failed) ul.append(Object.assign(document.createElement('li'), { textContent: `Ligne ${f.line}${f.label ? ` (${f.label})` : ''} : ${f.error}` }));
    box.append(ul); failed.append(box);
  }

  const g = job.geometry, margin = g.marks ? 9 : g.bleed;
  const W = g.trim.w + 2 * margin, H = g.trim.h + 2 * margin;
  const place = (el, inset) => {
    Object.assign(el.style, { left: `${(inset / W) * 100}%`, right: `${(inset / W) * 100}%`, top: `${(inset / H) * 100}%`, bottom: `${(inset / H) * 100}%` });
  };

  const cards = $('#cards');
  cards.replaceChildren();
  for (const c of job.cards) {
    const el = Object.assign(document.createElement('article'), { className: 'card' });
    el.append(Object.assign(document.createElement('h3'), { textContent: c.label }));
    for (let p = 1; p <= c.pages; p++) {
      const sheet = Object.assign(document.createElement('div'), { className: 'sheet' });
      sheet.append(Object.assign(document.createElement('img'), {
        src: `/api/jobs/${job.id}/cards/${c.n}/preview/${p}.png`, alt: `Aperçu de la carte de ${c.label}, page ${p}`, loading: 'lazy',
      }));
      for (const [name, inset] of [['bleed', margin - g.bleed], ['trim', margin], ['safe', margin + g.safe]]) {
        const b = Object.assign(document.createElement('div'), { className: `box ${name}` });
        place(b, inset); sheet.append(b);
      }
      el.append(sheet);
    }
    if (c.warnings.length) {
      const ul = Object.assign(document.createElement('ul'), { className: 'warns' });
      for (const w of c.warnings) ul.append(Object.assign(document.createElement('li'), { textContent: w }));
      el.append(ul);
    }
    el.append(Object.assign(document.createElement('a'), { className: 'button', href: `/api/jobs/${job.id}/cards/${c.n}/pdf`, textContent: 'PDF de cette carte' }));
    cards.append(el);
  }
  $('#zip').href = `/api/jobs/${job.id}/archive.zip`;
  $('#zip').hidden = job.cards.length === 0;
  syncLayers();
  $('#results').scrollIntoView({ behavior: 'smooth' });
}

function syncLayers() {
  for (const sheet of document.querySelectorAll('.sheet'))
    for (const cb of document.querySelectorAll('[data-layer]')) sheet.toggleAttribute(`data-${cb.dataset.layer}`, cb.checked);
}
for (const cb of document.querySelectorAll('[data-layer]')) cb.addEventListener('change', syncLayers);

onMode();
try { const me = await api('/api/me'); await showApp(me.email); } catch { showLogin(); }
