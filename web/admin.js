const $ = (s, r = document) => r.querySelector(s);
const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };

async function call(path, opts = {}) {
  const r = await fetch(path, opts);
  const body = r.headers.get('content-type')?.includes('json') ? await r.json() : null;
  if (!r.ok) throw Object.assign(new Error(body?.error || 'Erreur inattendue.'), { body, status: r.status });
  return body;
}
const api = (path, opts) => call(`/api/admin${path}`, opts);
const json = (method, data) => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
const say = (sel, msg = '') => { $(sel).textContent = msg; };
const btn = (text, fn, props = {}) => { const b = el('button', { type: 'button', textContent: text, ...props }); b.addEventListener('click', fn); return b; };
const field = (label, input) => el('label', {}, label, input);

let state = { clients: [] };
const open = new Set();          // fiches ouvertes
const fontMsg = {};              // dernier message d'ajout de polices par client
const drafts = {};               // brouillon d'import par client { draft, template, previews, warnings, testProfile }

async function refresh() {
  state = await api('/state');
  $('#noToken').hidden = state.figmaConfigured;
  $('#adminWho').textContent = state.me;
  $('#clientCount').textContent = `(${state.clients.length})`;
  $('#clients').replaceChildren(...state.clients.map(renderClient));
}
const failOn = (sel) => async (fn) => { try { await fn(); } catch (e) { say(sel, e.message); } };
const guard = failOn('#globalError');

function renderClient(c) {
  const url = `${location.origin}/${c.slug}`;
  const box = el('details', { className: 'panel clientBox', open: open.has(c.slug) });
  box.addEventListener('toggle', () => (box.open ? open.add(c.slug) : open.delete(c.slug)));
  const visible = c.templates.filter((t) => !t.hidden).length;
  box.append(el('summary', {},
    el('b', { textContent: c.name }), ` (${c.slug}) · ${visible}/${c.templates.length} modèle(s) · ${c.users.length} compte(s)`,
    c.builtin ? el('span', { className: 'badge', textContent: 'dépôt' }) : ''));
  const err = el('p', { className: 'error', role: 'alert' });
  const run = async (fn) => { err.textContent = ''; try { await fn(); } catch (e) { err.textContent = e.message; } };

  // En-tête : adresse et actions
  box.append(el('p', { className: 'hint' }, 'Adresse : ', el('a', { href: url, target: '_blank', rel: 'noopener', textContent: url })));
  box.append(el('div', { className: 'actions' },
    btn('Renommer', () => run(async () => {
      const name = prompt('Nouveau nom affiché :', c.name);
      if (name && name.trim()) { await api(`/clients/${c.slug}`, json('PATCH', { name })); await refresh(); }
    })),
    btn('Supprimer ce client', () => run(async () => {
      const typed = prompt(`Supprime la page, les modèles, les polices, les ${c.users.length} compte(s) et les cartes enregistrées de « ${c.name} ».\nTapez « ${c.slug} » pour confirmer :`);
      if (typed === null) return;
      const r = await api(`/clients/${c.slug}`, json('DELETE', { confirm: typed.trim() }));
      open.delete(c.slug); delete drafts[c.slug]; await refresh();
      say('#globalError', `Client « ${c.slug} » supprimé (${r.usersRemoved} compte(s) retiré(s)).`);
    }), { disabled: c.builtin, title: c.builtin ? 'Client défini dans le dépôt' : '' })));
  box.append(err);

  // Modèles
  box.append(el('h3', { textContent: 'Modèles disponibles pour ce client' }));
  const tl = el('ul', { className: 'tpl' });
  for (const t of c.templates) {
    const li = el('li', {}, el('b', { textContent: t.name }), ` — ${t.id} · ${t.fields} champ(s) · ${t.pages} ${t.kind === 'digital' ? 'format(s)' : 'page(s)'} `,
      t.kind === 'digital' ? el('span', { className: 'badge', textContent: 'bannières' }) : '', t.builtin ? el('span', { className: 'badge', textContent: 'intégré' }) : '', t.hidden ? el('span', { className: 'badge warn', textContent: 'masqué' }) : '');
    li.append(el('div', { className: 'thumbs' }, ...Array.from({ length: t.pages }, (_, i) => el('img', {
      src: `/api/admin/templates/${c.slug}/${t.id}/preview/${i + 1}.png`, alt: `Aperçu de ${t.name}, page ${i + 1}`, loading: 'lazy' }))));
    li.append(btn(t.hidden ? 'Afficher' : 'Masquer', () => run(async () => { await api(`/templates/${c.slug}/${t.id}/visibility`, json('POST', { hidden: !t.hidden })); await refresh(); }),
      { title: t.hidden ? 'Proposer ce modèle au client' : 'Ne plus proposer ce modèle pour de nouvelles cartes (les cartes existantes restent)' }));
    const others = state.clients.filter((o) => o.slug !== c.slug);
    if (others.length) {
      const sel = el('select', { ariaLabel: 'Copier vers' }, ...others.map((o) => el('option', { value: o.slug, textContent: o.name })));
      li.append('Copier vers :', sel, btn('Copier', () => run(async () => {
        await api('/templates/copy', json('POST', { from: c.slug, id: t.id, to: sel.value }));
        open.add(sel.value); await refresh();
      })));
    }
    if (!t.builtin) li.append(btn('Retirer', () => run(async () => {
      if (!confirm(`Retirer définitivement le modèle « ${t.name} » ? (pour le masquer sans le perdre, utilisez « Masquer »)`)) return;
      await api(`/templates/${c.slug}/${t.id}`, { method: 'DELETE' }); await refresh();
    })));
    tl.append(li);
  }
  box.append(tl.children.length ? tl : el('p', { className: 'hint', textContent: 'Aucun modèle : importez-en un depuis Figma ci-dessous.' }));

  box.append(importSection(c, run));

  // Polices
  box.append(el('h3', { textContent: 'Polices' }));
  box.append(el('p', { className: 'hint', textContent: c.fonts.length ? c.fonts.join(', ') : 'Aucune police propre à ce client (les polices partagées, comme Inter, sont toujours disponibles).' }));
  const files = el('input', { type: 'file', accept: '.otf,.ttf', multiple: true });
  const fontErr = el('p', { className: 'error', role: 'alert' }), fontOk = el('p', { className: 'hint', role: 'status' });
  const add = btn('Ajouter', async () => {
    fontErr.textContent = ''; fontOk.textContent = '';
    if (!files.files.length) { fontErr.textContent = 'Choisissez d\'abord un ou plusieurs fichiers de police (.otf ou .ttf).'; return; }
    const fd = new FormData();
    for (const f of files.files) fd.append('fonts', f);
    add.disabled = true; add.textContent = 'Envoi…';
    try {
      const r = await api(`/fonts?client=${encodeURIComponent(c.slug)}`, { method: 'POST', body: fd });
      open.add(c.slug); fontMsg[c.slug] = `Ajoutée(s) : ${r.saved.join(', ')}`; await refresh();
    } catch (e) { fontErr.textContent = e.message; add.disabled = false; add.textContent = 'Ajouter'; }
  });
  fontOk.textContent = fontMsg[c.slug] || ''; delete fontMsg[c.slug];
  box.append(el('div', { className: 'inline' }, field('Ajouter des polices (.otf ou .ttf — le nom du fichier n\'a pas d\'importance)', files), add), fontErr, fontOk);

  // Comptes
  box.append(el('h3', { textContent: 'Comptes' }));
  const ul = el('ul', { className: 'tpl' });
  for (const u of c.users) {
    const li = el('li', {}, u.email, u.admin ? el('span', { className: 'badge', textContent: 'admin' }) : '');
    if (!u.admin) li.append(btn('Supprimer', () => run(async () => {
      if (!confirm(`Supprimer le compte ${u.email} ?`)) return;
      await api(`/users/${encodeURIComponent(u.email)}`, { method: 'DELETE' }); await refresh();
    })));
    ul.append(li);
  }
  box.append(ul.children.length ? ul : el('p', { className: 'hint', textContent: 'Aucun compte.' }));
  const email = el('input', { type: 'email', autocomplete: 'off' }), pw = el('input', { type: 'password', minLength: 10, autocomplete: 'new-password' });
  const ok = el('p', { className: 'hint' });
  box.append(el('div', { className: 'inline' }, field('E-mail', email), field('Mot de passe (10 caractères min.)', pw),
    btn('Créer / réinitialiser le compte', () => run(async () => {
      ok.textContent = '';
      await api('/users', json('POST', { email: email.value, password: pw.value, client: c.slug }));
      ok.textContent = `Compte enregistré : ${email.value}`; email.value = ''; pw.value = '';
      open.add(c.slug); await refresh();
    }))), ok);
  return box;
}

function importSection(c, run) {
  const wrap = el('div', { className: 'importBox' }, el('h3', { textContent: 'Ajouter un modèle' }), el('p', { className: 'hint', textContent: 'Carte imprimée : depuis un design Figma. Bannière : depuis un package web (ZIP).' }), el('h4', { textContent: 'Carte imprimée — depuis Figma' }));
  const url = el('input', { type: 'text', placeholder: 'https://www.figma.com/design/…?node-id=1-2' });
  const id = el('input', { type: 'text', placeholder: 'carte-v1', pattern: '[a-z0-9\\-]{1,40}' });
  const name = el('input', { type: 'text', placeholder: 'Carte ACME' });
  const problems = el('ul', { className: 'problems' });
  const info = el('p', { className: 'error', role: 'alert' });
  const busy = el('p', { className: 'hint', textContent: 'Import en cours…', hidden: true });
  const go = btn('Importer et prévisualiser', async () => {
    info.textContent = ''; problems.replaceChildren(); delete drafts[c.slug];
    go.disabled = true; busy.hidden = false;
    try {
      const d = await api('/import', json('POST', { client: c.slug, url: url.value, id: id.value, name: name.value }));
      drafts[c.slug] = d; open.add(c.slug); await refresh();
    } catch (e) {
      info.textContent = e.message;
      problems.replaceChildren(...[...(e.body?.problems || []), ...(e.body?.warnings || []).map((w) => `⚠ ${w}`)].map((p) => el('li', { textContent: p })));
    } finally { go.disabled = false; busy.hidden = true; }
  }, { className: 'primary' });
  wrap.append(field('Lien Figma de la section (clic droit → Copy link to selection)', url), field('Identifiant du modèle', id), field('Nom du modèle', name), info, problems, go, busy);

  // Bannière : package web (ZIP)
  const zip = el('input', { type: 'file', accept: '.zip,application/zip' });
  const pid = el('input', { type: 'text', placeholder: 'banniere-v1', pattern: '[a-z0-9\\-]{1,40}' });
  const pname = el('input', { type: 'text', placeholder: 'Bannières ACME' });
  const pinfo = el('p', { className: 'error', role: 'alert' }), pproblems = el('ul', { className: 'problems' });
  const pbusy = el('p', { className: 'hint', textContent: 'Analyse et rendu des aperçus…', hidden: true });
  const pgo = btn('Importer le package et prévisualiser', async () => {
    pinfo.textContent = ''; pproblems.replaceChildren(); delete drafts[c.slug];
    if (!zip.files.length) { pinfo.textContent = 'Choisissez le fichier ZIP du modèle.'; return; }
    const fd = new FormData(); fd.append('zip', zip.files[0]);
    pgo.disabled = true; pbusy.hidden = false;
    try {
      const q = new URLSearchParams({ client: c.slug, id: pid.value, name: pname.value });
      drafts[c.slug] = await api(`/packages?${q}`, { method: 'POST', body: fd }); open.add(c.slug); await refresh();
    } catch (e) {
      pinfo.textContent = e.message;
      pproblems.replaceChildren(...[...(e.body?.problems || []), ...(e.body?.warnings || []).map((w) => `⚠ ${w}`)].map((p) => el('li', { textContent: p })));
    } finally { pgo.disabled = false; pbusy.hidden = true; }
  }, { className: 'primary' });
  wrap.append(el('h4', { textContent: 'Bannière — depuis un package web (HTML/CSS, images, polices)' }),
    el('p', { className: 'hint' }, 'Un fichier .html par format, taille dans ', el('code', { textContent: '<meta name="banner:size">' }), ', champs variables en ', el('code', { textContent: 'data-field' }), '. ',
      el('a', { href: '/api/admin/example-package.zip', textContent: 'Télécharger un package d\'exemple' })),
    field('Fichier ZIP', zip), field('Identifiant du modèle', pid), field('Nom du modèle', pname), pinfo, pproblems, pgo, pbusy);

  const d = drafts[c.slug];
  if (d) {
    wrap.append(el('h3', { textContent: `Aperçu : ${d.template.name}` }));
    if (d.testProfile) wrap.append(el('p', { className: 'notice warn', textContent: "Profil d'impression de TEST : ne pas envoyer ces fichiers à l'imprimeur." }));
    wrap.append(el('ul', { className: 'warns' }, ...d.warnings.map((w) => el('li', { textContent: w }))));
    wrap.append(el('div', { className: 'cards' }, ...Array.from({ length: d.previews }, (_, i) =>
      el('div', { className: 'sheet' }, el('img', { src: `/api/admin/drafts/${d.draft}/preview/${i + 1}.png`, alt: `Aperçu du modèle, page ${i + 1}` })))));
    wrap.append(el('p', { className: 'hint', textContent: `${d.template.trim ? `${d.template.trim.w} × ${d.template.trim.h} mm` : `Formats : ${d.template.formats.join(' · ')}`}. Champs : ${d.template.fields.join(', ')}.` }));
    const pe = el('p', { className: 'error', role: 'alert' });
    wrap.append(btn('Publier ce modèle pour ce client', async () => {
      pe.textContent = '';
      try { await api(`/drafts/${d.draft}/publish`, { method: 'POST' }); delete drafts[c.slug]; await refresh(); }
      catch (e) { pe.textContent = e.message; }
    }, { className: 'primary' }), btn('Abandonner', async () => { delete drafts[c.slug]; await refresh(); }), pe);
  }
  return wrap;
}

$('#clientForm').addEventListener('submit', async (e) => {
  e.preventDefault(); say('#clientError');
  const d = Object.fromEntries(new FormData(e.target));
  try { await api('/clients', json('POST', d)); e.target.reset(); open.add(d.slug); await refresh(); } catch (err) { say('#clientError', err.message); }
});

$('#adminLoginForm').addEventListener('submit', async (e) => {
  e.preventDefault(); say('#adminLoginError');
  try { await call('/api/login', json('POST', Object.fromEntries(new FormData(e.target)))); e.target.reset(); await start(); }
  catch (err) { say('#adminLoginError', err.message); }
});
$('#adminLogout').addEventListener('click', async () => { await call('/api/logout', { method: 'POST' }); await start(); });

async function start() {
  $('#originHint').textContent = location.origin;
  say('#fatal');
  const me = await fetch('/api/me');
  const logged = me.ok;
  $('#adminLogin').hidden = logged; $('#adminBar').hidden = !logged; $('#admin').hidden = true;
  if (!logged) return;
  if (!(await me.json()).admin) { say('#fatal', 'Cette page est réservée aux administrateurs.'); return; }
  $('#admin').hidden = false;
  await refresh();
}
try { await start(); } catch (e) { say('#fatal', e.message); }
