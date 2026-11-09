// Comptes (connexion Discord), profil, faction, membres, invitations et marqueurs en ligne (Supabase).
// Toute la sécurité est côté base (règles RLS + fonctions) : ce fichier ne fait qu'afficher et appeler.
(() => {
  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  const ROLES = ['createur', 'chef', 'elu', 'conseiller', 'architecte', 'cartographe', 'diplomate', 'milicien', 'mercenaire',
    'citoyen', 'marchand', 'forgeron', 'fermier', 'mineur', 'medecin', 'eclaireur', 'nouveau'];
  const TAGS = ['pvp', 'marchande', 'mercenaires', 'exploration', 'agriculture', 'artisanat', 'roleplay'];
  const SITE = location.origin + location.pathname;

  const state = { user: null, profile: null, membership: null, faction: null, parent: null, members: [], history: [], invite: null, inviteInfo: null,
    tab: 'faction', previewRole: null, proposals: [], myVotes: {}, draft: {},
    mercs: [], myMerc: null, hires: [], hireDraft: {},
    relations: [], factions: [], independents: [], territories: [], drawing: null, joinRequests: [], markerData: [], secrets: null };
  const dbMarkers = [];
  const raidMarkers = [];

  const $ = sel => document.querySelector(sel);
  const t = k => I18N.t(k);
  const esc = s => String(s ?? '').replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // Rôle effectif : le Créateur peut prévisualiser le site « comme » un autre rôle (affichage seulement).
  const myRole = () => state.previewRole ?? state.membership?.role;
  const isCreator = () => myRole() === 'createur';
  // Gestionnaire : le Créateur ; en faction démocratique, le Chef aussi.
  const isManager = () => isCreator() || (myRole() === 'chef' && state.faction?.governance === 'democratic');
  const isSolo = () => !state.faction && !!state.profile?.solo;
  const myParty = () => state.faction ? 'f:' + state.faction.id : 'p:' + state.user?.id;
  const canDiplo = () => !state.faction || isManager() || myRole() === 'diplomate';
  const canDraw = () => !!state.faction && (isManager() || myRole() === 'cartographe');
  const canHire = () => !state.faction || ['createur', 'chef', 'diplomate'].includes(myRole());

  function say(msg, isError = false) {
    const el = $('#panel-msg');
    el.textContent = msg;
    el.className = isError ? 'error' : 'ok';
  }
  function errText(e) {
    let code = String(e?.message ?? e).trim();
    if (code.includes('factions_name_key')) code = 'name_taken';
    else if (code.includes('check constraint')) code = 'invalid_value';
    const k = 'err.' + code;
    return t(k) === k ? code : t(k);
  }
  // Confirmation intégrée au site (les fenêtres confirm() du navigateur peuvent être bloquées).
  function askConfirm(msg) {
    return new Promise(resolve => {
      const box = document.createElement('div');
      box.className = 'confirm';
      box.innerHTML = `<div><p>${esc(msg)}</p>
        <button data-ok class="danger">${esc(t('acc.confirm_yes'))}</button>
        <button data-no>${esc(t('acc.confirm_no'))}</button></div>`;
      const done = ok => { box.remove(); resolve(ok); };
      box.querySelector('[data-ok]').onclick = () => done(true);
      box.querySelector('[data-no]').onclick = () => done(false);
      document.body.appendChild(box);
      box.querySelector('[data-no]').focus();
    });
  }

  // Appel Supabase : affiche l'erreur éventuelle et renvoie null.
  async function call(promise) {
    const { data, error } = await promise;
    if (error) { say(errText(error), true); return null; }
    return data ?? true;
  }

  // ───────── Chargement ─────────
  async function load() {
    const { data: { session } } = await sb.auth.getSession();
    state.user = session?.user ?? null;
    Object.assign(state, { profile: null, membership: null, faction: null, parent: null, members: [], history: [] });

    if (state.user) {
      const uid = state.user.id;
      await sb.rpc('touch');
      await sb.rpc('close_due_proposals');   // clôture des votes échus (peut dissoudre la faction)
      const [p, m, h] = await Promise.all([
        sb.from('profiles').select('*').eq('id', uid).maybeSingle(),
        sb.from('memberships').select('faction_id, role').eq('profile_id', uid).maybeSingle(),
        sb.from('game_name_history').select('old_name, changed_at').eq('profile_id', uid).order('changed_at', { ascending: false })
      ]);
      state.profile = p.data;
      state.membership = m.data;
      state.history = h.data ?? [];

      if (state.membership) {
        const fid = state.membership.faction_id;
        const [f, mem] = await Promise.all([
          sb.from('factions').select('*').eq('id', fid).single(),
          sb.from('memberships').select('profile_id, role, joined_at, profiles(game_name, discord_name, last_seen_at)')
            .eq('faction_id', fid).order('joined_at')
        ]);
        state.faction = f.data;
        state.members = mem.data ?? [];
        await loadProposals();
        state.secrets = (await sb.from('faction_secrets').select('*').maybeSingle()).data;   // gestionnaires seulement
        if (state.faction?.parent_id) {
          state.parent = (await sb.from('factions').select('name').eq('id', state.faction.parent_id).maybeSingle()).data;
        }
      }
    }
    // Lien d'invitation : la recrue connectée rejoint directement la faction.
    if (state.user && state.invite && !state.faction) {
      const code = state.invite;
      state.invite = null;
      sessionStorage.removeItem('kfh-invite');
      const { error } = await sb.rpc('join_faction', { p_code: code });
      if (!error) { say(t('acc.joined')); return load(); }
      say(errText(error), true);
    }
    if (state.user) await Promise.all([loadMercs(), loadDiplo(), loadJoin()]);
    renderHeader();
    renderPanel();
    loadMarkers();
    drawRaidTargets();
    loadTerritories();
  }

  async function loadJoin() {
    const { data } = await sb.from('join_requests')
      .select('*, profiles(game_name, discord_name), factions(name)').eq('status', 'pending').order('created_at');
    state.joinRequests = data ?? [];
  }
  const incomingJoins = () => state.faction && isManager()
    ? state.joinRequests.filter(r => r.faction_id === state.faction.id) : [];

  async function loadDiplo() {
    const [r, f, ind] = await Promise.all([
      sb.from('relations').select('*'),
      sb.from('factions').select('id, name, color, tags').eq('status', 'active').order('name'),
      sb.rpc('list_independents')
    ]);
    state.relations = r.data ?? [];
    state.factions = f.data ?? [];
    state.independents = ind.data ?? [];
  }
  function partyName(p) {
    const [k, id] = p.split(':');
    if (k === 'f') return state.factions.find(x => x.id === id)?.name ?? '?';
    const i = state.independents.find(x => x.id === id);
    return i ? `${i.game_name} (${t('merc.solo')})` : '?';
  }

  async function loadMercs() {
    const [m, h] = await Promise.all([
      sb.from('mercenaries').select('*, profiles(game_name, discord_name, memberships(role, factions(name)))'),
      sb.from('hire_requests').select('*, merc:profiles!hire_requests_mercenary_id_fkey(game_name, discord_name), req:profiles!hire_requests_requester_id_fkey(game_name, discord_name)')
        .order('created_at', { ascending: false }).limit(50)
    ]);
    const all = m.data ?? [];
    state.myMerc = all.find(x => x.profile_id === state.user.id) ?? null;
    state.mercs = all.filter(x => x.available && x.profile_id !== state.user.id);
    state.hires = h.data ?? [];
  }

  async function loadProposals() {
    const [pr, v] = await Promise.all([
      sb.from('proposals').select('*').order('created_at', { ascending: false }).limit(60),
      sb.from('votes').select('proposal_id, choice')
    ]);
    state.proposals = pr.data ?? [];
    state.myVotes = Object.fromEntries((v.data ?? []).map(x => [x.proposal_id, x.choice]));
  }
  // Votes à jour sans recharger (vote depuis Discord ou par un autre membre) :
  // toutes les 20 s quand la page est visible, et dès qu'on revient sur l'onglet.
  async function refreshProposals() {
    if (!state.user || !state.faction || document.hidden) return;
    const sig = () => JSON.stringify([state.proposals.map(p => [p.id, p.status, p.yes_count, p.no_count, p.abstain_count]), state.myVotes]);
    const before = sig();
    await loadProposals();
    if (sig() === before) return;
    renderHeader();
    const typing = document.activeElement?.closest?.('#panel') && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
    if (state.tab === 'votes' && !$('#panel').hidden && !typing) renderPanel();
  }
  setInterval(refreshProposals, 20000);
  document.addEventListener('visibilitychange', refreshProposals);
  const canVote = () => !!state.faction && state.faction.voting_roles.includes(myRole());
  const openProposals = () => state.proposals.filter(p => p.status === 'open');
  const memberName = id => {
    const m = state.members.find(x => x.profile_id === id);
    return m ? (m.profiles?.game_name || m.profiles?.discord_name || '?') : '?';
  };
  const leader = () => state.members.find(m => m.role === 'createur');

  // ───────── En-tête ─────────
  function renderHeader() {
    const el = $('#auth');
    if (!state.user) {
      el.innerHTML = `<button data-act="login" class="discord">${esc(t('acc.login'))}</button>`;
    } else {
      const who = state.profile?.game_name || state.profile?.discord_name || '?';
      const todo = openProposals().filter(p => !state.myVotes[p.id]).length;
      const pending = state.hires.filter(h => h.mercenary_id === state.user.id && h.status === 'pending').length;
      const incoming = state.relations.filter(r => r.to_party === myParty() && r.stance === 'ally' &&
        !state.relations.some(x => x.from_party === myParty() && x.to_party === r.from_party && x.stance === 'ally')).length;
      if (state.faction || isSolo()) {
        const open = !$('#panel').hidden && !$('#panel').classList.contains('gate');
        const items = [['map', '🗺️ ' + t('nav.map'), 0],
          ['faction', (state.faction ? '🛡️ ' + state.faction.name : '👤 ' + t('acc.profile')), incomingJoins().length],
          ...(state.faction ? [['votes', '⚖️ ' + t('vote.tab'), canVote() ? todo : 0]] : []),
          ['diplo', '🤝 ' + t('diplo.tab'), canDiplo() ? incoming : 0],
          ['mercs', '🗡️ ' + t('merc.tab'), pending]];
        el.innerHTML = `<nav class="mainnav">${items.map(([k, label, n]) => {
            const active = k === 'map' ? !open : open && state.tab === k;
            return `<button data-act="nav" data-tab="${k}" class="${active ? 'active' : ''}">${esc(label)}${n ? ` <b class="badge">${n}</b>` : ''}</button>`;
          }).join('')}</nav>
          <span class="who">${esc(who)}${state.previewRole ? ` · 👁 ${esc(t('role.' + state.previewRole))}` : ''}
            <button data-act="logout" class="link">${esc(t('acc.logout'))}</button></span>`;
        $('#marker-visibility').hidden = !canPlaceMarker();
        $('#marker-main-label').hidden = !canPlaceMarker();
        return;
      }
      // Connecté sans faction (portail affiché) : seulement la déconnexion.
      el.innerHTML = `<span class="who">${esc(who)} <button data-act="logout" class="link">${esc(t('acc.logout'))}</button></span>`;
    }
    $('#marker-visibility').hidden = !canPlaceMarker();
    $('#marker-main-label').hidden = !canPlaceMarker();
  }

  // ───────── Panneau ─────────
  // Portail : page de connexion, puis pseudo + créer/rejoindre une faction, avant d'accéder à la carte.
  function renderPanel() {
    const body = $('#panel-body');
    const needName = state.user && (state.faction || isSolo()) && !state.profile?.game_name;
    const gate = !state.user || (!state.faction && !isSolo()) || needName;
    const wasGate = $('#panel').classList.contains('gate');
    $('#panel').classList.toggle('gate', gate);
    $('#panel-close').hidden = gate;
    if (gate) $('#panel').hidden = false;
    else if (wasGate) $('#panel').hidden = true;   // portail terminé : place à la carte

    if (!state.user) {
      const inv = state.inviteInfo;
      body.innerHTML = `<h1>Kenshi Faction Hub</h1>
        ${inv ? `<p class="invite-note">${esc(t('gate.invited'))} <b style="color:${esc(inv.faction_color)}">${esc(inv.faction_name)}</b></p>` : ''}
        <p class="tagline">${esc(t('gate.tagline'))}</p>
        <ul class="features"><li>${esc(t('gate.f_map'))}</li><li>${esc(t('gate.f_faction'))}</li><li>${esc(t('gate.f_diplo'))}</li></ul>
        ${state.invite && !inv ? `<p class="invite-note">${esc(t('acc.invite_login'))}</p>` : ''}
        <button data-act="login" class="discord big">${esc(t('acc.login'))}</button>
        <p class="hint">${esc(t('footer.credit'))}</p>`;
      return;
    }
    if (needName) {
      body.innerHTML = `<h1>${esc(t('gate.welcome'))}</h1>
        ${state.faction ? `<p>${esc(t('gate.joined_as'))} <b>${esc(state.faction.name)}</b> (${esc(t('role.' + myRole()))}).</p>` : ''}
        <h2>${esc(t('gate.step_profile'))}</h2>${profileFields()}
        <button data-act="finish-profile" class="big">${esc(t('gate.enter'))}</button>`;
      return;
    }
    if (!state.faction && !isSolo()) {
      body.innerHTML = `<h1>${esc(t('gate.welcome'))}</h1>
        <h2>1. ${esc(t('gate.step_profile'))}</h2>${profileFields()}
        <h2>2. ${esc(t('gate.step_faction'))}</h2>${noFactionHtml()}
        <button data-act="logout" class="link">${esc(t('acc.logout'))}</button>`;
      return;
    }
    const tabList = state.faction ? ['faction', 'votes', 'diplo', 'mercs'] : ['faction', 'diplo', 'mercs'];
    if (!tabList.includes(state.tab)) state.tab = 'faction';
    const tabs = state.previewRole ? `<p class="preview">👁 ${esc(t('preview.banner'))} <b>${esc(t('role.' + state.previewRole))}</b>
      <button data-act="preview" data-role="" class="small">${esc(t('preview.stop'))}</button></p>` : '';
    const content = state.tab === 'votes' ? votesHtml()
      : state.tab === 'diplo' ? diploHtml()
      : state.tab === 'mercs' ? mercsHtml()
      : state.faction ? profileHtml() + factionHtml()
      : profileHtml() + `<h2>${esc(t('merc.solo_title'))}</h2><p class="hint">${esc(t('merc.solo_hint'))}</p>` + noFactionHtml(false);
    body.innerHTML = tabs + content;
    updateVoteForm();
  }

  function profileFields() {
    const p = state.profile ?? {};
    return `<label>${esc(t('acc.game_name'))} <input id="p-game" maxlength="40" value="${esc(p.game_name)}"></label>
      <label>${esc(t('acc.discord_name'))} <input id="p-discord" maxlength="40" value="${esc(p.discord_name)}"></label>`;
  }
  function profileHtml() {
    const old = state.history.map(h => esc(h.old_name)).join(', ');
    return `<h2>${esc(t('acc.profile'))}</h2>${profileFields()}
      <p class="hint">${esc(t('acc.game_name_hint'))}</p>
      <button data-act="save-profile">${esc(t('acc.save'))}</button>
      ${old ? `<p class="hint">${esc(t('acc.old_names'))} : ${old}</p>` : ''}`;
  }
  // Enregistre le profil saisi dans le portail (pseudo en jeu obligatoire).
  async function saveProfileFromForm() {
    const game = $('#p-game').value.trim();
    if (!game) { say(t('err.game_name_required'), true); $('#p-game').focus(); return false; }
    return !!await call(sb.from('profiles').update({
      game_name: game, discord_name: $('#p-discord').value.trim()
    }).eq('id', state.user.id));
  }

  function governanceOptions(selected) {
    return ['authoritarian', 'democratic'].map(g =>
      `<option value="${g}" ${g === selected ? 'selected' : ''}>${esc(t('gov.' + g))}</option>`).join('');
  }

  function noFactionHtml(withSolo = true) {
    const join = `<div class="choice"><h3>${esc(t('acc.join_title'))}</h3>
      <label>${esc(t('acc.invite_code'))} <input id="j-code" value="${esc(state.invite)}"></label>
      <p class="hint">${esc(t('gate.join_hint'))}</p>
      <button data-act="join">${esc(t('acc.join'))}</button></div>`;
    const create = `<div class="choice"><h3>${esc(t('acc.create_title'))}</h3>
      <label>${esc(t('acc.faction_name'))} <input id="c-name" maxlength="40"></label>
      <label>${esc(t('acc.governance'))} <select id="c-gov">${governanceOptions('authoritarian')}</select></label>
      <p class="hint">${esc(t('acc.governance_hint'))}</p>
      <button data-act="create">${esc(t('acc.create'))}</button></div>`;
    const mine = state.joinRequests.filter(r => r.profile_id === state.user.id);
    const ask = state.factions.length ? `<div class="choice wide"><h3>${esc(t('join.title'))}</h3>
      <p class="hint">${esc(t('join.hint'))}</p>
      <label>${esc(t('join.faction'))} <select id="jr-faction">${state.factions.map(f =>
        `<option value="${f.id}">${esc(f.name)}${(f.tags ?? []).length ? ' — ' + f.tags.map(x => t('tag.' + x)).join(', ') : ''}</option>`).join('')}</select></label>
      <label>${esc(t('join.message'))} <input id="jr-message" maxlength="300" placeholder="${esc(t('join.message_ph'))}"></label>
      <button data-act="join-request">${esc(t('join.send'))}</button>
      ${mine.map(r => `<p class="hint">⏳ ${esc(t('join.pending'))} <b>${esc(r.factions?.name)}</b>
        <button data-act="join-cancel" data-id="${r.id}" class="link">${esc(t('merc.cancel'))}</button></p>`).join('')}</div>` : '';
    const solo = withSolo ? `<div class="choice wide"><h3>${esc(t('merc.solo_choice'))}</h3>
      <p class="hint">${esc(t('merc.solo_choice_hint'))}</p>
      <button data-act="go-solo">${esc(t('merc.solo_go'))}</button></div>` : '';
    return `<div class="choices">${state.invite ? join + create : create + join}${ask}${solo}</div>`;
  }

  function factionHtml() {
    const f = state.faction;
    const discord = /^https:\/\/(discord\.gg|discord\.com\/invite)\//.test(f.discord_invite ?? '')
      ? `<a class="button discord" href="${esc(f.discord_invite)}" target="_blank" rel="noopener">${esc(t('acc.join_discord'))}</a>` : '';
    let html = `<h2><i class="swatch" style="background:${esc(f.color)}"></i> ${esc(f.name)}</h2>
      <p class="hint">${esc(t('gov.' + f.governance))} · ${esc(t('acc.my_role'))} : ${esc(t('role.' + myRole()))}
      ${state.parent ? ` · ${esc(t('acc.split_from'))} ${esc(state.parent.name)}` : ''}</p>
      ${(f.tags ?? []).length ? `<p>${f.tags.map(x => `<span class="chip">${esc(t('tag.' + x))}</span>`).join(' ')}</p>` : ''}
      ${f.description ? `<p class="desc">${esc(f.description)}</p>` : ''}
      ${discord}`;

    if (state.membership.role === 'createur') {
      html += `<label class="preview-pick">👁 ${esc(t('preview.label'))} <select id="preview-role">
        <option value="">${esc(t('preview.none'))}</option>${ROLES.filter(r => r !== 'createur').map(r =>
          `<option value="${r}" ${state.previewRole === r ? 'selected' : ''}>${esc(t('role.' + r))}</option>`).join('')}</select></label>`;
    }
    const joins = incomingJoins();
    if (joins.length) {
      html += `<h3>📨 ${esc(t('join.incoming'))} (${joins.length})</h3>` + joins.map(r => `<article class="merc">
        <h3>${esc(r.profiles?.game_name || '?')} <span class="hint">· Discord : ${esc(r.profiles?.discord_name || '—')}</span></h3>
        ${r.message ? `<p class="desc">${esc(r.message)}</p>` : ''}
        <button data-act="join-answer" data-id="${r.id}" data-accept="1">${esc(t('merc.accept'))}</button>
        <button data-act="join-answer" data-id="${r.id}" data-accept="" class="danger">${esc(t('merc.decline'))}</button></article>`).join('');
    }
    if (isManager()) html += manageHtml(f);
    if (canDraw()) html += territoriesHtml();
    html += membersHtml();

    html += `<h3>${esc(t('acc.actions'))}</h3>`;
    if (!isCreator()) {
      html += `<details><summary>${esc(t('acc.split_title'))}</summary>
        <p class="hint">${esc(t('acc.split_hint'))}</p>
        <label>${esc(t('acc.faction_name'))} <input id="s-name" maxlength="40"></label>
        <label>${esc(t('acc.governance'))} <select id="s-gov">${governanceOptions(f.governance)}</select></label>
        <button data-act="split">${esc(t('acc.split'))}</button></details>`;
    }
    html += `<button data-act="leave" class="danger">${esc(t('acc.leave'))}</button>`;
    return html;
  }

  function manageHtml(f) {
    const voting = ROLES.map(r => `<label class="inline"><input type="checkbox" name="vote-role" value="${r}"
      ${f.voting_roles.includes(r) ? 'checked' : ''}> ${esc(t('role.' + r))}</label>`).join('');
    return `<details open><summary>${esc(t('acc.manage'))}</summary>
      <label>${esc(t('acc.color'))} <input id="f-color" type="color" value="${esc(f.color)}"></label>
      <label>${esc(t('acc.description'))} <textarea id="f-desc" maxlength="2000" rows="3">${esc(f.description)}</textarea></label>
      <label>${esc(t('acc.discord_invite'))} <input id="f-discord" placeholder="https://discord.gg/..." value="${esc(f.discord_invite)}"></label>
      <fieldset><legend>${esc(t('tag.title'))}</legend>${TAGS.map(x => `<label class="inline"><input type="checkbox" name="tag" value="${x}"
        ${(f.tags ?? []).includes(x) ? 'checked' : ''}> ${esc(t('tag.' + x))}</label>`).join('')}</fieldset>
      <fieldset><legend>${esc(t('acc.voting_roles'))}</legend>${voting}</fieldset>
      <label class="inline">${esc(t('vote.hours'))} <input id="f-hours" type="number" min="1" max="336" value="${f.vote_hours ?? 48}"></label>
      <label class="inline">${esc(t('vote.inactivity'))} <input id="f-inact" type="number" min="3" max="90" value="${f.inactivity_days ?? 14}"></label>
      <button data-act="save-faction">${esc(t('acc.save'))}</button>
      ${webhookHtml()}
      <h3>${esc(t('acc.invite_title'))}</h3>
      <label class="inline">${esc(t('acc.invite_days'))} <input id="i-days" type="number" min="1" max="90" value="7"></label>
      <label class="inline">${esc(t('acc.invite_uses'))} <input id="i-uses" type="number" min="1" max="500" value="10"></label>
      <button data-act="invite">${esc(t('acc.invite_create'))}</button>
      <input id="i-link" readonly hidden></details>`;
  }

  const HOOK_EVENTS = ['vote', 'result', 'member', 'join'];
  function webhookHtml() {
    const w = state.secrets ?? { lang: I18N.lang, events: HOOK_EVENTS };
    return `<h3>📣 ${esc(t('hook.title'))}</h3>
      <p class="hint">${esc(t('hook.hint'))}</p>
      <label>${esc(t('hook.url'))} <input id="w-url" type="password" autocomplete="off" placeholder="https://discord.com/api/webhooks/…" value="${esc(w.discord_webhook)}"></label>
      <label>${esc(t('hook.lang'))} <select id="w-lang">${['fr', 'en', 'ru'].map(l =>
        `<option value="${l}" ${w.lang === l ? 'selected' : ''}>${{ fr: 'Français', en: 'English', ru: 'Русский' }[l]}</option>`).join('')}</select></label>
      <fieldset><legend>${esc(t('hook.events'))}</legend>${HOOK_EVENTS.map(e => `<label class="inline"><input type="checkbox" name="w-ev" value="${e}"
        ${w.events.includes(e) ? 'checked' : ''}> ${esc(t('hook.ev_' + e))}</label>`).join('')}</fieldset>
      <h3>🤖 ${esc(t('bot.title'))}</h3>
      <p class="hint">${esc(t('bot.hint'))}</p>
      <a class="button discord" target="_blank" rel="noopener"
        href="https://discord.com/oauth2/authorize?client_id=1569234273108762785&permissions=309640317952&scope=bot">🤖 ${esc(t('bot.invite'))}</a>
      <label>${esc(t('bot.channel'))} <input id="w-channel" placeholder="https://discord.com/channels/…/…" value="${esc(w.discord_channel)}"></label>
      <p class="hint">${esc(t('bot.channel_hint'))}</p>
      <label class="inline"><input type="checkbox" id="w-roles" ${w.sync_roles !== false ? 'checked' : ''}> ${esc(t('bot.sync_roles'))}</label>
      <label class="inline"><input type="checkbox" id="w-nick" ${w.sync_nick !== false ? 'checked' : ''}> ${esc(t('bot.sync_nick'))}</label><br>
      <button data-act="save-hook">${esc(t('acc.save'))}</button>
      ${state.secrets?.discord_webhook ? `<button data-act="test-hook">${esc(t('hook.test'))}</button>` : ''}
      ${state.secrets?.discord_channel ? `<button data-act="bot-resync">🔄 ${esc(t('bot.resync'))}</button>
        <div id="bot-status">${botStatusHtml()}</div>` : ''}`;
  }
  // Compte rendu de la dernière synchronisation (écrit par le bot).
  function botStatusHtml() {
    const s = state.secrets?.bot_status, at = state.secrets?.bot_synced_at;
    if (!s || !at) return '';
    const when = new Date(at).toLocaleString(I18N.lang);
    if (s.error) return `<p class="error">⚠️ ${esc(when)} — ${esc(t('bot.err_' + s.error))}</p>`;
    const rows = ['ok', 'not_on_server', 'no_discord', 'nick', 'failed'].filter(k => s[k])
      .map(k => `<li>${k === 'ok' ? '✅' : '⚠️'} ${esc(t('bot.st_' + k).replace('{n}', s[k]))}</li>`).join('');
    return `<p class="hint">🕓 ${esc(t('bot.last_sync'))} ${esc(when)} · ${esc(t('bot.st_roles').replace('{n}', s.roles))}</p><ul class="bot-status">${rows}</ul>`;
  }

  function membersHtml() {
    const rows = state.members.map(m => {
      const self = m.profile_id === state.user.id;
      const editable = isManager() && !self && (isCreator() || m.role !== 'createur');
      const roles = isCreator() ? ROLES : ROLES.filter(r => r !== 'createur');
      const role = editable
        ? `<select data-member="${m.profile_id}" class="m-role">${roles.map(r =>
            `<option value="${r}" ${r === m.role ? 'selected' : ''}>${esc(t('role.' + r))}</option>`).join('')}</select>
           <button data-act="kick" data-member="${m.profile_id}" class="danger small">${esc(t('acc.kick'))}</button>`
        : esc(t('role.' + m.role));
      return `<tr><td>${esc(m.profiles?.game_name || '—')}</td><td>${esc(m.profiles?.discord_name || '—')}</td><td>${role}</td></tr>`;
    }).join('');
    return `<h3>${esc(t('acc.members'))} (${state.members.length})</h3>
      <table class="members"><tr><th>${esc(t('acc.game_name'))}</th><th>Discord</th><th>${esc(t('acc.role'))}</th></tr>${rows}</table>`;
  }

  // ───────── Votes ─────────
  const KINDS = ['general', 'resources', 'raid', 'governance', 'dissolution', 'depose'];
  const fmtDate = d => new Date(d).toLocaleString(I18N.lang, { dateStyle: 'medium', timeStyle: 'short' });
  function timeLeft(d) {
    const h = Math.max(0, Math.floor((new Date(d) - Date.now()) / 3.6e6));
    return h >= 24 ? `${Math.floor(h / 24)} ${t('vote.days')} ${h % 24} h` : `${Math.max(h, 1)} h`;
  }
  function leaderInactive() {
    const l = leader();
    if (!l) return true;
    const seen = l.profiles?.last_seen_at ? new Date(l.profiles.last_seen_at) : new Date();
    return Date.now() - seen > (state.faction.inactivity_days ?? 14) * 864e5;
  }

  function proposalHtml(p) {
    const mine = state.myVotes[p.id];
    const binding = state.faction.governance === 'democratic' || ['governance', 'dissolution', 'depose'].includes(p.kind);
    const extra = [];
    if (p.kind === 'raid' && p.event_at) extra.push(`⚔ ${esc(fmtDate(p.event_at))}`);
    if (p.target_x != null) extra.push(`<button data-act="show-target" data-x="${p.target_x}" data-y="${p.target_y}" class="small">${esc(t('vote.show_target'))}</button>`);
    if (p.kind === 'depose') extra.push(`${esc(t('vote.candidate'))} : <b>${esc(memberName(p.target_profile))}</b>`);
    const counts = `👍 ${p.yes_count} · 👎 ${p.no_count} · ⚪ ${p.abstain_count}`;
    let footer;
    if (p.status === 'open') {
      const btn = (c, label) => `<button data-act="vote" data-id="${p.id}" data-choice="${c}" class="${mine === c ? 'active' : ''}">${label}</button>`;
      footer = `<p class="hint">${esc(t('vote.closes_in'))} ${esc(timeLeft(p.closes_at))} · ${counts}</p>
        ${canVote() ? btn('yes', esc(t('vote.yes'))) + btn('no', esc(t('vote.no'))) + btn('abstain', esc(t('vote.abstain'))) : `<p class="hint">${esc(t('vote.no_right'))}</p>`}
        ${p.created_by === state.user.id || myRole() === 'createur'
          ? `<button data-act="cancel-vote" data-id="${p.id}" class="link">${esc(t('vote.cancel'))}</button>` : ''}`;
    } else {
      footer = `<p class="status ${p.status}">${esc(t('vote.status_' + p.status))} · ${counts}</p>`;
    }
    return `<article class="proposal ${p.status}">
      <p class="hint">${esc(t('vote.kind_' + p.kind))}${binding ? '' : ` · ${esc(t('vote.advisory'))}`} · ${esc(t('vote.by'))} ${esc(memberName(p.created_by))}</p>
      <h3>${esc(p.title)}</h3>
      ${p.description ? `<p class="desc">${esc(p.description)}</p>` : ''}
      ${extra.length ? `<p>${extra.join(' · ')}</p>` : ''}
      ${footer}</article>`;
  }

  function votesHtml() {
    const d = state.draft;
    const kinds = KINDS.filter(k => k !== 'depose' || leaderInactive());
    const candidates = state.members.filter(m => m.role !== 'createur');
    const form = canVote() ? `<details ${d.open ? 'open' : ''} id="v-details"><summary>${esc(t('vote.new'))}</summary>
      <label>${esc(t('vote.kind'))} <select id="v-kind">${kinds.map(k =>
        `<option value="${k}" ${k === (d.kind ?? 'general') ? 'selected' : ''}>${esc(t('vote.kind_' + k))}</option>`).join('')}</select></label>
      <p class="hint" id="v-kind-hint"></p>
      <label>${esc(t('vote.title'))} <input id="v-title" maxlength="120" value="${esc(d.title)}"></label>
      <label>${esc(t('acc.description'))} <textarea id="v-desc" maxlength="4000" rows="3">${esc(d.desc)}</textarea></label>
      <div id="v-raid">
        <label>${esc(t('vote.event_at'))} <input id="v-date" type="datetime-local" value="${esc(d.date)}"></label>
        <button data-act="pick-target">${esc(t('vote.pick_target'))}</button>
        <span class="hint">${d.x != null ? `${esc(t('vote.target'))} : ${d.x}, ${d.y}` : ''}</span>
      </div>
      <label id="v-depose">${esc(t('vote.candidate'))} <select id="v-target">${candidates.map(m =>
        `<option value="${m.profile_id}">${esc(memberName(m.profile_id))}</option>`).join('')}</select></label>
      <button data-act="propose">${esc(t('vote.submit'))}</button></details>`
      : `<p class="hint">${esc(t('vote.no_right'))}</p>`;
    const open = openProposals();
    const closed = state.proposals.filter(p => p.status !== 'open').slice(0, 15);
    return `<h2>${esc(t('vote.tab'))}</h2>
      <p class="hint">${esc(t(state.faction.governance === 'democratic' ? 'vote.rule_demo' : 'vote.rule_auth'))}</p>
      ${form}
      <h3>${esc(t('vote.open'))} (${open.length})</h3>
      ${open.map(proposalHtml).join('') || `<p class="hint">${esc(t('vote.none'))}</p>`}
      ${closed.length ? `<h3>${esc(t('vote.closed'))}</h3>${closed.map(proposalHtml).join('')}` : ''}`;
  }

  // Affiche les champs utiles selon le type de proposition.
  function updateVoteForm() {
    const kind = $('#v-kind')?.value;
    if (!kind) return;
    $('#v-raid').hidden = kind !== 'raid';
    $('#v-depose').hidden = kind !== 'depose';
    $('#v-kind-hint').textContent = t('vote.hint_' + kind);
  }
  function saveDraft() {
    if (!$('#v-kind')) return;
    Object.assign(state.draft, {
      open: $('#v-details')?.open, kind: $('#v-kind').value, title: $('#v-title').value,
      desc: $('#v-desc').value, date: $('#v-date').value
    });
  }

  // Cibles des raids en cours sur la carte.
  function drawRaidTargets() {
    if (!KFH.map) return;
    raidMarkers.splice(0).forEach(l => l.remove());
    for (const p of openProposals().filter(p => p.target_x != null)) {
      raidMarkers.push(KFH.dot(p.target_x, p.target_y, '#ff2d2d', 11)
        .bindTooltip(() => `⚔ ${esc(p.title)}${p.event_at ? ' — ' + esc(fmtDate(p.event_at)) : ''}`)
        .addTo(KFH.markerLayer));
    }
  }

  // ───────── Diplomatie ─────────
  const SHARES = ['none', 'main', 'bases', 'all'];
  function diploHtml() {
    const me = myParty();
    const mine = Object.fromEntries(state.relations.filter(r => r.from_party === me).map(r => [r.to_party, r]));
    const theirs = Object.fromEntries(state.relations.filter(r => r.to_party === me).map(r => [r.from_party, r]));
    const edit = canDiplo();
    const btn = (act, party, label, extra = '') =>
      edit ? `<button data-act="${act}" data-party="${party}" ${extra}>${esc(t(label))}</button>` : '';
    const row = (party, body) => `<article class="merc"><h3>${esc(partyName(party))}</h3>${body}</article>`;

    const allies = Object.keys(mine).filter(p => mine[p].stance === 'ally' && theirs[p]?.stance === 'ally');
    const incoming = Object.keys(theirs).filter(p => theirs[p].stance === 'ally' && mine[p]?.stance !== 'ally');
    const outgoing = Object.keys(mine).filter(p => mine[p].stance === 'ally' && theirs[p]?.stance !== 'ally');
    const enemies = Object.keys(mine).filter(p => mine[p].stance === 'enemy');
    const hostile = Object.keys(theirs).filter(p => theirs[p].stance === 'enemy');
    const known = new Set([...allies, ...incoming, ...outgoing, ...enemies]);
    const others = [
      ...state.factions.filter(f => 'f:' + f.id !== me).map(f => ({ p: 'f:' + f.id, tags: f.tags })),
      ...state.independents.filter(i => 'p:' + i.id !== me).map(i => ({ p: 'p:' + i.id, tags: [] }))
    ].filter(o => !known.has(o.p));

    const shareSelect = p => edit
      ? `<label>${esc(t('diplo.share'))} <select class="d-share" data-party="${p}">${SHARES.map(x =>
          `<option value="${x}" ${mine[p].share === x ? 'selected' : ''}>${esc(t('diplo.share_' + x))}</option>`).join('')}</select></label>`
      : `<p class="hint">${esc(t('diplo.share'))} : ${esc(t('diplo.share_' + mine[p].share))}</p>`;

    const section = (title, list) => list.length ? `<h3>${esc(t(title))} (${list.length})</h3>${list.join('')}` : '';
    return `<h2>${esc(t('diplo.tab'))}</h2>
      <p class="hint">${esc(t('diplo.intro'))}</p>
      ${edit ? '' : `<p class="hint">${esc(t('diplo.no_right'))}</p>`}
      ${section('diplo.incoming', incoming.map(p => row(p,
        btn('d-ally', p, 'diplo.accept') + btn('d-neutral', p, 'diplo.decline', 'class="danger"'))))}
      ${section('diplo.allies', allies.map(p => row(p, shareSelect(p) + btn('d-neutral', p, 'diplo.break', 'class="link"'))))}
      ${section('diplo.outgoing', outgoing.map(p => row(p, `<p class="hint">${esc(t('diplo.waiting'))}</p>` + btn('d-neutral', p, 'diplo.cancel', 'class="link"'))))}
      ${section('diplo.enemies', enemies.map(p => row(p, btn('d-neutral', p, 'diplo.peace'))))}
      ${section('diplo.hostile', hostile.map(p => row(p, `<p class="hint">⚔ ${esc(t('diplo.hostile_hint'))}</p>`)))}
      ${section('diplo.others', others.map(o => row(o.p,
        `${(o.tags ?? []).map(x => `<span class="chip">${esc(t('tag.' + x))}</span>`).join(' ')}<br>` +
        btn('d-ally', o.p, 'diplo.propose') + btn('d-enemy', o.p, 'diplo.declare_enemy', 'class="danger"'))))}`;
  }

  async function relation(party, stance, share = null) {
    const ok = await call(sb.rpc('set_relation', { p_to: party, p_stance: stance, p_share: share }));
    if (ok) { say(t('acc.saved')); await loadDiplo(); renderPanel(); loadMarkers(); drawTerritories(); }
  }

  // ───────── Territoires ─────────
  const TERR_STYLE = {
    own:     { color: '#4a9be8', weight: 2, fillOpacity: .15, className: 'terr-own' },
    ally:    { color: '#e8b04a', weight: 3, fillOpacity: .2, className: 'terr-ally' },
    enemy:   { color: '#c0392b', weight: 3, fillOpacity: .55, dashArray: '10 6', className: 'terr-enemy' },
    neutral: { color: '#9a8f80', weight: 2, fillOpacity: .06, dashArray: '4 6', className: 'terr-neutral' },
    danger:  { color: '#9b59b6', weight: 3, fillOpacity: .3, dashArray: '2 6', className: 'terr-enemy' }
  };
  function stanceWith(fid) {
    if (fid === state.faction?.id) return 'own';
    if (!state.user) return 'neutral';
    const me = myParty(), them = 'f:' + fid;
    const mine = state.relations.find(r => r.from_party === me && r.to_party === them)?.stance;
    const theirs = state.relations.find(r => r.from_party === them && r.to_party === me)?.stance;
    if (mine === 'enemy' || theirs === 'enemy') return 'enemy';
    if (mine === 'ally' && theirs === 'ally') return 'ally';
    return 'neutral';
  }
  // Motif hachuré (défini une fois dans le SVG de la carte) pour les territoires ennemis.
  function hatch(svg) {
    if (svg.querySelector('#kfh-hatch')) return;
    svg.insertAdjacentHTML('afterbegin', `<defs><pattern id="kfh-hatch" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <rect width="10" height="10" fill="#3a0d08" fill-opacity=".35"/><line x1="0" y1="0" x2="0" y2="10" stroke="#c0392b" stroke-width="4" stroke-opacity=".7"/></pattern></defs>`);
  }
  async function loadTerritories() {
    if (!KFH.map) return;
    const [{ data }, f] = await Promise.all([
      sb.from('territories').select('*'),
      state.factions.length ? { data: state.factions } : sb.from('factions').select('id, name, color, tags').eq('status', 'active')
    ]);
    if (!state.factions.length) state.factions = f.data ?? [];
    state.territories = data ?? [];
    drawTerritories();
    if (state.tab === 'faction' && !$('#panel').hidden && !$('#panel').classList.contains('gate')) renderPanel();
  }
  function drawTerritories() {
    KFH.territoryLayer.clearLayers();
    for (const z of state.territories) {
      // Zone « à nous » : apparence selon la relation ; sinon le type choisi au tracé.
      const stance = (z.kind ?? 'own') === 'own' ? stanceWith(z.faction_id) : z.kind;
      const poly = L.polygon(z.points.map(([x, y]) => KFH.toLatLng(x, y)), TERR_STYLE[stance])
        .bindTooltip(() => `<b>${esc(z.name)}</b><br>${esc(partyName('f:' + z.faction_id))} · ${esc(t('terr.' + stance))}`, { sticky: true })
        .addTo(KFH.territoryLayer);
      if (stance === 'enemy' && poly._path) { hatch(poly._path.ownerSVGElement); poly._path.setAttribute('fill', 'url(#kfh-hatch)'); }
      poly.bringToBack();   // sous les marqueurs
    }
  }
  function territoriesHtml() {
    const mine = state.territories.filter(z => z.faction_id === state.faction.id);
    return `<h3>🗺️ ${esc(t('terr.title'))} (${mine.length})</h3>
      ${mine.map(z => `<p>${esc(z.name)}
        <button data-act="terr-show" data-id="${z.id}" class="small">${esc(t('vote.show_target'))}</button>
        <button data-act="terr-delete" data-id="${z.id}" class="small danger">${esc(t('marker.delete'))}</button></p>`).join('')}
      <label>${esc(t('terr.name'))} <input id="t-name" maxlength="60"></label>
      <label>${esc(t('terr.kind'))} <select id="t-kind">${['own', 'ally', 'neutral', 'danger'].map(k =>
        `<option value="${k}">${esc(t('terr.kind_' + k))}</option>`).join('')}</select></label>
      <label>${esc(t('terr.visibility'))} <select id="t-vis">${['public', 'allies', 'faction'].map(v =>
        `<option value="${v}">${esc(t('marker.vis_' + v))}</option>`).join('')}</select></label>
      <button data-act="terr-draw">✏️ ${esc(t('terr.draw'))}</button>`;
  }
  // Mode tracé : chaque clic ajoute un coin ; barre « Terminer / Annuler » au-dessus de la carte.
  function drawStep() {
    const d = state.drawing;
    $('#draw-count').textContent = `${t('terr.points')} : ${d.points.length}`;
    d.line?.remove();
    d.line = L.polygon(d.points.map(([x, y]) => KFH.toLatLng(x, y)), { color: '#e8b04a', dashArray: '4 4', fillOpacity: .1 }).addTo(KFH.map);
    KFH.onPick = p => { d.points.push([p.x, p.y]); drawStep(); };
  }
  function drawEnd() {
    state.drawing?.line?.remove();
    state.drawing = null;
    KFH.onPick = null;
    $('#draw-bar').hidden = true;
  }

  // ───────── Mercenaires ─────────
  function mercsHtml() {
    const me = state.myMerc ?? { available: false };
    const mine = `<details ${state.myMerc ? '' : 'open'}><summary>${esc(t('merc.my_profile'))}</summary>
      <label class="inline"><input type="checkbox" id="m-available" ${me.available ? 'checked' : ''}> ${esc(t('merc.available'))}</label>
      <label>${esc(t('merc.skills'))} <input id="m-skills" maxlength="500" value="${esc(me.skills)}" placeholder="${esc(t('merc.skills_ph'))}"></label>
      <label>${esc(t('merc.rates'))} <input id="m-rates" maxlength="300" value="${esc(me.rates)}"></label>
      <label>${esc(t('merc.region'))} <input id="m-region" maxlength="100" value="${esc(me.region)}"></label>
      <button data-act="save-merc">${esc(t('acc.save'))}</button></details>`;

    const d = state.hireDraft;
    const pool = state.mercs.map(m => {
      const p = m.profiles ?? {};
      const mem = Array.isArray(p.memberships) ? p.memberships[0] : p.memberships;
      const form = d.merc === m.profile_id ? `<div class="hire-form">
          <label>${esc(t('merc.mission'))} <textarea id="h-mission" maxlength="1000" rows="2">${esc(d.mission)}</textarea></label>
          <label>${esc(t('merc.reward'))} <input id="h-reward" maxlength="200" value="${esc(d.reward)}"></label>
          <label>${esc(t('merc.when'))} <input id="h-date" type="datetime-local" value="${esc(d.date)}"></label>
          <button data-act="hire-pick">${esc(t('vote.pick_target'))}</button>
          <span class="hint">${d.x != null ? `${esc(t('vote.target'))} : ${d.x}, ${d.y}` : ''}</span><br>
          <button data-act="hire-send" data-id="${m.profile_id}">${esc(t('merc.send'))}</button></div>`
        : (canHire() ? `<button data-act="hire-open" data-id="${m.profile_id}">${esc(t('merc.hire'))}</button>` : '');
      return `<article class="merc"><h3>${esc(p.game_name || '?')} <span class="hint">· Discord : ${esc(p.discord_name || '—')}</span></h3>
        <p class="hint">${mem ? `${esc(mem.factions?.name)} (${esc(t('role.' + mem.role))})` : esc(t('merc.solo'))}${m.region ? ' · ' + esc(m.region) : ''}</p>
        ${m.skills ? `<p>${esc(m.skills)}</p>` : ''}${m.rates ? `<p>💰 ${esc(m.rates)}</p>` : ''}${form}</article>`;
    }).join('');

    const hireRow = h => {
      const toMe = h.mercenary_id === state.user.id;
      const other = toMe ? h.req : h.merc;
      const actions = toMe && h.status === 'pending'
        ? `<button data-act="hire-answer" data-id="${h.id}" data-status="accepted">${esc(t('merc.accept'))}</button>
           <button data-act="hire-answer" data-id="${h.id}" data-status="declined" class="danger">${esc(t('merc.decline'))}</button>`
        : (!toMe && ['pending', 'accepted'].includes(h.status)
          ? `<button data-act="hire-answer" data-id="${h.id}" data-status="cancelled" class="link">${esc(t('merc.cancel'))}</button>` : '');
      return `<article class="proposal ${h.status === 'accepted' ? 'passed' : h.status === 'pending' ? 'open' : 'rejected'}">
        <p class="hint">${esc(t(toMe ? 'merc.from' : 'merc.to'))} <b>${esc(other?.game_name || '?')}</b> (Discord : ${esc(other?.discord_name || '—')}) · ${esc(t('merc.status_' + h.status))}</p>
        <p class="desc">${esc(h.mission)}</p>
        <p>${h.reward ? `💰 ${esc(h.reward)} ` : ''}${h.event_at ? `· 🕒 ${esc(fmtDate(h.event_at))} ` : ''}
          ${h.target_x != null ? `<button data-act="show-target" data-x="${h.target_x}" data-y="${h.target_y}" class="small">${esc(t('vote.show_target'))}</button>` : ''}</p>
        ${actions}</article>`;
    };
    const received = state.hires.filter(h => h.mercenary_id === state.user.id);
    const sent = state.hires.filter(h => h.mercenary_id !== state.user.id);

    return `<h2>${esc(t('merc.tab'))}</h2>${mine}
      ${received.length ? `<h3>${esc(t('merc.received'))}</h3>${received.map(hireRow).join('')}` : ''}
      ${sent.length ? `<h3>${esc(t('merc.sent'))}</h3>${sent.map(hireRow).join('')}` : ''}
      <h3>${esc(t('merc.pool'))} (${state.mercs.length})</h3>
      ${canHire() ? '' : `<p class="hint">${esc(t('merc.cannot_hire'))}</p>`}
      ${pool || `<p class="hint">${esc(t('merc.none'))}</p>`}`;
  }
  function saveHireDraft() {
    if (!$('#h-mission')) return;
    Object.assign(state.hireDraft, { mission: $('#h-mission').value, reward: $('#h-reward').value, date: $('#h-date').value });
  }

  // ───────── Actions ─────────
  const actions = {
    async login() {
      await sb.auth.signInWithOAuth({ provider: 'discord', options: { redirectTo: SITE } });
    },
    async logout() {
      await sb.auth.signOut();
      say('');
      load();
    },
    nav(btn) {
      const tab = btn.dataset.tab;
      const open = !$('#panel').hidden;
      saveDraft(); saveHireDraft();
      if (tab === 'map' || (open && state.tab === tab)) { $('#panel').hidden = true; }
      else { state.tab = tab; renderPanel(); $('#panel').hidden = false; $('#panel').scrollTop = 0; }
      renderHeader();
    },
    preview(btn) {
      state.previewRole = btn.dataset.role || null;
      renderHeader(); renderPanel(); loadMarkers();
    },
    'terr-draw'() {
      const name = $('#t-name').value.trim();
      if (!name) { say(t('terr.name_required'), true); $('#t-name').focus(); return; }
      state.drawing = { name, kind: $('#t-kind').value, visibility: $('#t-vis').value, points: [] };
      $('#panel').hidden = true; renderHeader();
      $('#draw-bar').hidden = false;
      drawStep();
    },
    async 'terr-done'() {
      const d = state.drawing;
      if (!d || d.points.length < 3) { $('#draw-count').textContent = t('terr.min3'); return; }
      const ok = await call(sb.from('territories').insert({
        faction_id: state.faction.id, created_by: state.user.id, name: d.name, kind: d.kind, visibility: d.visibility, points: d.points
      }));
      drawEnd();
      if (ok) { say(t('terr.saved')); await loadTerritories(); }
      $('#panel').hidden = false; renderHeader();
    },
    'terr-cancel'() { drawEnd(); $('#panel').hidden = false; renderHeader(); },
    'terr-show'(btn) {
      const z = state.territories.find(x => x.id === +btn.dataset.id);
      $('#panel').hidden = true; renderHeader();
      KFH.map.fitBounds(L.latLngBounds(z.points.map(([x, y]) => KFH.toLatLng(x, y))), { padding: [40, 40] });
    },
    async 'terr-delete'(btn) {
      if (!await askConfirm(t('terr.delete_confirm'))) return;
      if (await call(sb.from('territories').delete().eq('id', +btn.dataset.id))) loadTerritories();
    },
    async 'save-hook'() {
      const ok = await call(sb.from('faction_secrets').upsert({
        faction_id: state.faction.id, discord_webhook: $('#w-url').value.trim() || null, lang: $('#w-lang').value,
        events: [...document.querySelectorAll('input[name=w-ev]:checked')].map(i => i.value), updated_at: new Date().toISOString(),
        discord_channel: $('#w-channel').value.trim() || null, sync_roles: $('#w-roles').checked, sync_nick: $('#w-nick').checked
      }));
      if (ok) { say(t('acc.saved')); state.secrets = (await sb.from('faction_secrets').select('*').maybeSingle()).data; renderPanel(); }
    },
    async 'bot-resync'() {
      const before = state.secrets?.bot_synced_at;
      if (!await call(sb.rpc('bot_resync'))) return;
      const box = $('#bot-status');
      if (box) box.innerHTML = `<p class="hint">⏳ ${esc(t('bot.resync_sent'))}</p>`;
      for (let i = 0; i < 15; i++) {   // le bot répond en quelques secondes
        await new Promise(r => setTimeout(r, 2000));
        const { data } = await sb.from('faction_secrets').select('*').maybeSingle();
        if (data?.bot_synced_at && data.bot_synced_at !== before) {
          state.secrets = data;
          const b = $('#bot-status');
          if (b) { b.innerHTML = botStatusHtml(); b.scrollIntoView({ block: 'nearest' }); }
          return;
        }
      }
      if ($('#bot-status')) $('#bot-status').innerHTML = `<p class="error">⚠️ ${esc(t('bot.no_answer'))}</p>`;
    },
    async 'test-hook'() {
      if (await call(sb.rpc('test_webhook'))) say(t('hook.test_sent'));
    },
    async 'join-request'() {
      if ($('#p-game') && !await saveProfileFromForm()) return;   // portail : pseudo en jeu obligatoire
      const ok = await call(sb.rpc('request_join', { p_faction: $('#jr-faction').value, p_message: $('#jr-message').value }));
      if (ok) { say(t('join.sent')); await loadJoin(); renderPanel(); }
    },
    async 'join-cancel'(btn) {
      if (await call(sb.rpc('cancel_join', { p_request: +btn.dataset.id }))) { await loadJoin(); renderPanel(); }
    },
    async 'join-answer'(btn) {
      const ok = await call(sb.rpc('answer_join', { p_request: +btn.dataset.id, p_accept: !!btn.dataset.accept }));
      if (ok) { say(t(btn.dataset.accept ? 'join.accepted' : 'join.declined')); await load(); }
    },
    async 'd-ally'(btn) {
      const r = state.relations.find(x => x.from_party === myParty() && x.to_party === btn.dataset.party);
      await relation(btn.dataset.party, 'ally', r?.stance === 'ally' ? r.share : 'main');
    },
    async 'd-neutral'(btn) { await relation(btn.dataset.party, 'neutral'); },
    async 'd-enemy'(btn) {
      if (await askConfirm(t('diplo.enemy_confirm'))) await relation(btn.dataset.party, 'enemy');
    },
    async 'go-solo'() {
      if (!await saveProfileFromForm()) return;
      const ok = await call(sb.from('profiles').update({ solo: true }).eq('id', state.user.id));
      if (ok) await load();
    },
    async 'save-merc'() {
      const ok = await call(sb.from('mercenaries').upsert({
        profile_id: state.user.id, available: $('#m-available').checked,
        skills: $('#m-skills').value.trim() || null, rates: $('#m-rates').value.trim() || null,
        region: $('#m-region').value.trim() || null, updated_at: new Date().toISOString()
      }));
      if (ok) { say(t('acc.saved')); await loadMercs(); renderPanel(); }
    },
    'hire-open'(btn) { state.hireDraft = { merc: btn.dataset.id }; renderPanel(); },
    'hire-pick'() {
      saveHireDraft();
      $('#panel').hidden = true;
      $('#marker-hint').textContent = t('vote.pick_hint');
      KFH.onPick = p => {
        Object.assign(state.hireDraft, { x: p.x, y: p.y });
        $('#marker-hint').textContent = t('map.hint');
        renderPanel();
        $('#panel').hidden = false;
      };
    },
    async 'hire-send'(btn) {
      saveHireDraft();
      const d = state.hireDraft;
      const ok = await call(sb.rpc('request_hire', {
        p_mercenary: btn.dataset.id, p_mission: (d.mission ?? '').trim(), p_reward: (d.reward ?? '').trim(),
        p_event_at: d.date ? new Date(d.date).toISOString() : null, p_x: d.x ?? null, p_y: d.y ?? null
      }));
      if (ok) { state.hireDraft = {}; say(t('merc.sent_ok')); await loadMercs(); renderPanel(); }
    },
    async 'hire-answer'(btn) {
      const ok = await call(sb.rpc('answer_hire', { p_request: +btn.dataset.id, p_status: btn.dataset.status }));
      if (ok) { await loadMercs(); renderHeader(); renderPanel(); }
    },
    async vote(btn) {
      const ok = await call(sb.rpc('cast_vote', { p_proposal: +btn.dataset.id, p_choice: btn.dataset.choice }));
      if (ok) { await loadProposals(); renderHeader(); renderPanel(); }
    },
    async 'cancel-vote'(btn) {
      if (!await askConfirm(t('vote.cancel_confirm'))) return;
      const ok = await call(sb.rpc('cancel_proposal', { p_proposal: +btn.dataset.id }));
      if (ok) { await loadProposals(); renderHeader(); renderPanel(); drawRaidTargets(); }
    },
    async propose() {
      saveDraft();
      const d = state.draft;
      const kind = d.kind;
      if (['dissolution', 'depose'].includes(kind) && !await askConfirm(t('vote.confirm_' + kind))) return;
      const ok = await call(sb.rpc('create_proposal', {
        p_kind: kind, p_title: d.title.trim(), p_description: d.desc.trim(),
        p_event_at: kind === 'raid' && d.date ? new Date(d.date).toISOString() : null,
        p_x: kind === 'raid' ? d.x ?? null : null, p_y: kind === 'raid' ? d.y ?? null : null,
        p_target: kind === 'depose' ? $('#v-target').value : null
      }));
      if (ok) {
        state.draft = {};
        say(t('vote.created'));
        await loadProposals(); renderHeader(); renderPanel(); drawRaidTargets();
      }
    },
    'pick-target'() {
      saveDraft();
      $('#panel').hidden = true;
      $('#marker-hint').textContent = t('vote.pick_hint');
      KFH.onPick = p => {
        Object.assign(state.draft, { x: p.x, y: p.y, open: true });
        $('#marker-hint').textContent = t('map.hint');
        renderPanel();
        $('#panel').hidden = false;
      };
    },
    'show-target'(btn) {
      $('#panel').hidden = true;
      renderHeader();
      KFH.map.flyTo(KFH.toLatLng(+btn.dataset.x, +btn.dataset.y), 4);
    },
    async 'save-profile'() {
      const ok = await call(sb.from('profiles').update({
        game_name: $('#p-game').value.trim(), discord_name: $('#p-discord').value.trim()
      }).eq('id', state.user.id));
      if (ok) { say(t('acc.saved')); load(); }
    },
    async 'finish-profile'() {
      if (await saveProfileFromForm()) { await load(); }
    },
    async create() {
      if (!await saveProfileFromForm()) return;
      const ok = await call(sb.rpc('create_faction', { p_name: $('#c-name').value.trim(), p_governance: $('#c-gov').value }));
      if (ok) { say(t('acc.created')); await load(); $('#panel').hidden = true; }
    },
    async join() {
      if (!await saveProfileFromForm()) return;
      let code = $('#j-code').value.trim();
      const m = code.match(/[?&]invite=([^&#]+)/);   // lien complet collé au lieu du code
      if (m) code = decodeURIComponent(m[1]);
      const ok = await call(sb.rpc('join_faction', { p_code: code }));
      if (ok) { state.invite = null; sessionStorage.removeItem('kfh-invite'); say(t('acc.joined')); await load(); $('#panel').hidden = true; }
    },
    async 'save-faction'() {
      const roles = [...document.querySelectorAll('input[name=vote-role]:checked')].map(i => i.value);
      const ok = await call(sb.from('factions').update({
        color: $('#f-color').value,
        description: $('#f-desc').value.trim() || null,
        discord_invite: $('#f-discord').value.trim() || null,
        voting_roles: roles,
        tags: [...document.querySelectorAll('input[name=tag]:checked')].map(i => i.value),
        vote_hours: +$('#f-hours').value,
        inactivity_days: +$('#f-inact').value
      }).eq('id', state.faction.id));
      if (ok) { say(t('acc.saved')); load(); }
    },
    async invite() {
      const code = await call(sb.rpc('create_invite', { p_days: +$('#i-days').value, p_max_uses: +$('#i-uses').value }));
      if (!code) return;
      const link = $('#i-link');
      link.hidden = false;
      link.value = `${SITE}?invite=${encodeURIComponent(code)}`;
      link.select();
      try { await navigator.clipboard.writeText(link.value); say(t('acc.invite_copied')); }
      catch (e) { say(t('acc.invite_ready')); }
    },
    async kick(btn) {
      if (!await askConfirm(t('acc.kick_confirm'))) return;
      const ok = await call(sb.rpc('kick_member', { p_profile: btn.dataset.member }));
      if (ok) load();
    },
    async leave() {
      const last = isCreator() && state.members.length === 1;
      if (!await askConfirm(t(last ? 'acc.leave_delete_confirm' : 'acc.leave_confirm'))) return;
      const ok = await call(sb.rpc('leave_faction'));
      if (ok) { say(t('acc.left')); load(); }
    },
    async split() {
      if (!await askConfirm(t('acc.split_confirm'))) return;
      const ok = await call(sb.rpc('create_faction', {
        p_name: $('#s-name').value.trim(), p_governance: $('#s-gov').value, p_parent: state.faction.id
      }));
      if (ok) { say(t('acc.created')); load(); }
    }
  };

  document.addEventListener('click', e => {
    const btn = e.target.closest('[data-act]');
    if (btn && actions[btn.dataset.act]) { e.preventDefault(); actions[btn.dataset.act](btn); }
  });
  document.addEventListener('change', async e => {
    if (e.target.id === 'v-kind') { updateVoteForm(); return; }
    if (e.target.id === 'preview-role') {
      state.previewRole = e.target.value || null;
      renderHeader(); renderPanel(); loadMarkers();
      return;
    }
    if (e.target.matches('.d-share')) { await relation(e.target.dataset.party, 'ally', e.target.value); return; }
    if (!e.target.matches('.m-role')) return;
    const role = e.target.value;
    if (role === 'createur' && !await askConfirm(t('acc.transfer_confirm'))) { renderPanel(); return; }
    const ok = await call(sb.rpc('set_member_role', { p_profile: e.target.dataset.member, p_role: role }));
    if (ok) { say(t('acc.saved')); load(); }
  });
  $('#panel-close').addEventListener('click', () => { $('#panel').hidden = true; renderHeader(); });

  // ───────── Marqueurs en ligne ─────────
  function canPlaceMarker() {
    return (!!state.faction && myRole() !== 'nouveau') || isSolo();
  }
  function canDelete(m) {
    if (!state.user) return false;
    if (!m.faction_id) return m.created_by === state.user.id;   // point de chute personnel
    return m.faction_id === state.faction?.id &&
      (m.created_by === state.user.id || ['createur', 'chef', 'architecte'].includes(myRole()));
  }

  async function loadMarkers() {
    if (!KFH.map) return;
    const { data } = await sb.from('markers').select('*');
    state.markerData = data ?? [];
    dbMarkers.splice(0).forEach(l => l.remove());
    for (const m of data ?? []) {
      const own = m.faction_id ? m.faction_id === state.faction?.id : m.created_by === state.user?.id;
      const owner = m.faction_id ? 'f:' + m.faction_id : 'p:' + m.created_by;
      const layer = KFH.dot(m.x, m.y, KFH.MARKER_STYLES[m.type] ?? KFH.MARKER_STYLES.other, m.is_main ? 11 : 8)
        .bindTooltip(() => `${m.is_main ? '★ ' : ''}${esc(m.name)} (${t('marker.' + m.type)})` +
          (own ? '' : `<br>🤝 ${esc(partyName(owner))}`));
      if (!own) layer.setStyle({ color: '#8fbf6a', weight: 3, dashArray: '3 3' });   // marqueur d'un allié
      if (canDelete(m)) {
        layer.bindPopup(() => {
          const div = document.createElement('div');
          div.className = 'marker-popup';
          const view = () => {
            div.innerHTML = `<b>${m.is_main ? '★ ' : ''}${esc(m.name)}</b><br>
              <button data-edit>✏️ ${esc(t('marker.edit'))}</button> <button data-del>${esc(t('marker.delete'))}</button>`;
            div.querySelector('[data-del]').onclick = async () => {
              if (await askConfirm(t('marker.delete_confirm')) && await call(sb.from('markers').delete().eq('id', m.id))) loadMarkers();
            };
            div.querySelector('[data-edit]').onclick = edit;
          };
          const edit = () => {
            const opt = (list, cur, key) => list.map(v => `<option value="${v}" ${v === cur ? 'selected' : ''}>${esc(t(key + v))}</option>`).join('');
            div.innerHTML = `<input data-f="name" maxlength="60" value="${esc(m.name)}">
              <select data-f="type">${opt(Object.keys(KFH.MARKER_STYLES), m.type, 'marker.')}</select>
              <select data-f="visibility">${opt(['faction', 'allies', 'public'], m.visibility, 'marker.vis_')}</select>
              <label><input type="checkbox" data-f="is_main" ${m.is_main ? 'checked' : ''}> ${esc(t('marker.main'))}</label>
              <button data-save>${esc(t('acc.save'))}</button> <button data-cancel>${esc(t('acc.confirm_no'))}</button>`;
            const f = k => div.querySelector(`[data-f=${k}]`);
            div.querySelector('[data-cancel]').onclick = view;
            div.querySelector('[data-save]').onclick = async () => {
              const ok = await call(sb.from('markers').update({
                name: f('name').value.trim() || m.name, type: f('type').value,
                visibility: f('visibility').value, is_main: f('type').value === 'own_base' && f('is_main').checked
              }).eq('id', m.id));
              if (ok) { KFH.map.closePopup(); loadMarkers(); }
            };
          };
          view();
          return div;
        });
      }
      layer.addTo(KFH.markerLayer);
      dbMarkers.push(layer);
    }
  }

  KFH.extraSearch = () => [
    ...state.markerData.map(m => ({ name: m.name, x: m.x, y: m.y })),
    ...state.territories.map(z => ({ name: z.name, points: z.points }))
  ];

  KFH.onMarkerPlaced = async m => {
    if (!canPlaceMarker()) return false;
    const ok = await call(sb.from('markers').insert({
      ...m, faction_id: state.faction?.id ?? null, created_by: state.user.id,
      visibility: $('#marker-visibility').value,
      is_main: m.type === 'own_base' && $('#marker-main').checked
    }));
    if (ok) loadMarkers();
    return !!ok;
  };

  // ───────── Démarrage ─────────
  // Lien d'invitation : ?invite=CODE → mémorisé, puis panneau ouvert sur « Rejoindre ».
  const params = new URLSearchParams(location.search);
  if (params.get('invite')) {
    sessionStorage.setItem('kfh-invite', params.get('invite'));
    history.replaceState(null, '', SITE);
  }
  state.invite = sessionStorage.getItem('kfh-invite');

  // Échec de connexion renvoyé par Supabase (?error_description=...) : on l'affiche au lieu de rester muet.
  const authError = params.get('error_description') ||
    new URLSearchParams(location.hash.slice(1)).get('error_description');
  if (authError) {
    history.replaceState(null, '', SITE);
    $('#panel').hidden = false;
    setTimeout(() => say(`${t('err.login_failed')} (${authError})`, true), 0);
  }

  sb.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') setTimeout(load, 0);
  });
  document.addEventListener('kfh:lang', () => { renderHeader(); renderPanel(); });
  document.addEventListener('kfh:map-ready', () => { loadMarkers(); drawRaidTargets(); loadTerritories(); });

  (async () => {
    if (state.invite) {
      const { data } = await sb.rpc('invite_info', { p_code: state.invite });
      state.inviteInfo = data?.[0] ?? null;
    }
    load();
  })();
})();
