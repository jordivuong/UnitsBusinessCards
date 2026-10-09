const $ = (s, r = document) => r.querySelector(s);
const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };

async function api(path, opts = {}) {
  const r = await fetch(`/api/admin${path}`, opts);
  const body = r.headers.get('content-type')?.includes('json') ? await r.json() : null;
  if (!r.ok) throw Object.assign(new Error(body?.error || 'Erreur inattendue.'), { body });
  return body;
}
const json = (method, data) => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
const form = (f) => Object.fromEntries(new FormData(f));
const say = (sel, msg = '') => { $(sel).textContent = msg; };

let draftId = null;

async function refresh() {
  const { clients, figmaConfigured } = await api('/state');
  $('#noToken').hidden = figmaConfigured;
  for (const sel of ['#importClient', '#fontClient', '#userClient']) {
    const keep = $(sel).value;
    $(sel).replaceChildren(...clients.map((c) => el('option', { value: c.slug, textContent: `${c.name} (${c.slug})` })));
    if (clients.some((c) => c.slug === keep)) $(sel).value = keep;
  }
  $('#clients').replaceChildren(...clients.map((c) => {
    const box = el('div', { className: 'client' }, el('h3', { textContent: `${c.name} (${c.slug})` }));
    box.append(el('p', { className: 'hint', textContent: `Polices : ${c.fonts.join(', ') || 'aucune'}` }));
    const ul = el('ul', { className: 'tpl' });
    for (const t of c.templates) {
      const li = el('li', {}, `${t.name} — ${t.id} · ${t.fields} champ(s)${t.builtin ? ' · intégré' : ''} `);
      if (!t.builtin) {
        const b = el('button', { className: 'link', textContent: 'Retirer' });
        b.addEventListener('click', async () => {
          if (!confirm(`Retirer le modèle « ${t.name} » ? Les clients ne pourront plus l'utiliser.`)) return;
          try { await api(`/templates/${c.slug}/${t.id}`, { method: 'DELETE' }); await refresh(); } catch (e) { say('#clientError', e.message); }
        });
        li.append(b);
      }
      ul.append(li);
    }
    box.append(ul.children.length ? ul : el('p', { className: 'hint', textContent: 'Aucun modèle.' }));
    return box;
  }));
}

$('#clientForm').addEventListener('submit', async (e) => {
  e.preventDefault(); say('#clientError');
  try { await api('/clients', json('POST', form(e.target))); e.target.reset(); await refresh(); } catch (err) { say('#clientError', err.message); }
});

$('#fontForm').addEventListener('submit', async (e) => {
  e.preventDefault(); say('#fontError');
  const fd = new FormData();
  for (const f of $('#fontFiles').files) fd.append('fonts', f);
  try {
    await api(`/fonts?client=${encodeURIComponent($('#fontClient').value)}`, { method: 'POST', body: fd });
    e.target.reset(); await refresh();
  } catch (err) { say('#fontError', err.message); }
});

$('#userForm').addEventListener('submit', async (e) => {
  e.preventDefault(); say('#userError'); $('#userOk').hidden = true;
  const d = form(e.target);
  try {
    await api('/users', json('POST', d));
    $('#userOk').textContent = `Compte créé : ${d.email}`; $('#userOk').hidden = false; e.target.reset();
  } catch (err) { say('#userError', err.message); }
});

$('#importForm').addEventListener('submit', async (e) => {
  e.preventDefault(); say('#importError'); $('#problems').replaceChildren(); $('#draft').hidden = true; draftId = null;
  $('#importGo').disabled = true; $('#importBusy').hidden = false;
  try {
    const d = await api('/import', json('POST', form(e.target)));
    draftId = d.draft;
    $('#draftTest').hidden = !d.testProfile;
    $('#draftWarns').replaceChildren(...d.warnings.map((w) => el('li', { textContent: w })));
    $('#draftSheets').replaceChildren(...Array.from({ length: d.previews }, (_, i) => el('div', { className: 'sheet' },
      el('img', { src: `/api/admin/drafts/${d.draft}/preview/${i + 1}.png`, alt: `Aperçu du modèle, page ${i + 1}` }))));
    $('#draftInfo').textContent = `${d.template.name} — ${d.template.trim.w} × ${d.template.trim.h} mm. Champs : ${d.template.fields.join(', ')}.`;
    $('#draft').hidden = false;
    $('#draft').scrollIntoView({ behavior: 'smooth' });
  } catch (err) {
    say('#importError', err.message);
    const list = [...(err.body?.problems || []), ...(err.body?.warnings || []).map((w) => `⚠ ${w}`)];
    $('#problems').replaceChildren(...list.map((p) => el('li', { textContent: p })));
  } finally { $('#importGo').disabled = false; $('#importBusy').hidden = true; }
});

$('#publish').addEventListener('click', async () => {
  say('#publishError');
  try {
    await api(`/drafts/${draftId}/publish`, { method: 'POST' });
    $('#draft').hidden = true; $('#importForm').reset(); draftId = null;
    await refresh();
    alert('Modèle publié : les comptes du client le voient dès maintenant.');
  } catch (err) { say('#publishError', err.message); }
});

try {
  const me = await fetch('/api/me');
  if (me.status === 401) location.href = '/';
  else if (!(await me.json()).admin) say('#fatal', 'Cette page est réservée aux administrateurs.');
  else { $('#admin').hidden = false; await refresh(); }
} catch (e) { say('#fatal', e.message); }
