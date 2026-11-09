// Comptes (connexion Discord), profil, faction, membres, invitations et marqueurs en ligne (Supabase).
// Toute la sécurité est côté base (règles RLS + fonctions) : ce fichier ne fait qu'afficher et appeler.
(() => {
  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  const ROLES = ['createur', 'conseiller', 'architecte', 'diplomate', 'milicien', 'citoyen',
    'marchand', 'forgeron', 'fermier', 'mineur', 'medecin', 'eclaireur', 'nouveau'];
  const SITE = location.origin + location.pathname;

  const state = { user: null, profile: null, membership: null, faction: null, parent: null, members: [], history: [], invite: null, inviteInfo: null,
    tab: 'faction', proposals: [], myVotes: {}, draft: {} };
  const dbMarkers = [];
  const raidMarkers = [];

  const $ = sel => document.querySelector(sel);
  const t = k => I18N.t(k);
  const esc = s => String(s ?? '').replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const isCreator = () => state.membership?.role === 'createur';

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
    renderHeader();
    renderPanel();
    loadMarkers();
    drawRaidTargets();
  }

  async function loadProposals() {
    const [pr, v] = await Promise.all([
      sb.from('proposals').select('*').order('created_at', { ascending: false }).limit(60),
      sb.from('votes').select('proposal_id, choice')
    ]);
    state.proposals = pr.data ?? [];
    state.myVotes = Object.fromEntries((v.data ?? []).map(x => [x.proposal_id, x.choice]));
  }
  const canVote = () => !!state.faction && state.faction.voting_roles.includes(state.membership.role);
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
      el.innerHTML = `<button data-act="open">${esc(who)} · ${esc(state.faction?.name ?? t('acc.no_faction'))}</button>
        ${state.faction ? `<button data-act="open-votes">${esc(t('vote.tab'))}${canVote() && todo ? ` <b class="badge">${todo}</b>` : ''}</button>` : ''}
        <button data-act="logout">${esc(t('acc.logout'))}</button>`;
    }
    $('#marker-visibility').hidden = !canPlaceMarker();
  }

  // ───────── Panneau ─────────
  // Portail : page de connexion, puis pseudo + créer/rejoindre une faction, avant d'accéder à la carte.
  function renderPanel() {
    const body = $('#panel-body');
    const needName = state.user && state.faction && !state.profile?.game_name;
    const gate = !state.user || !state.faction || needName;
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
        <p>${esc(t('gate.joined_as'))} <b>${esc(state.faction.name)}</b> (${esc(t('role.' + state.membership.role))}).</p>
        <h2>${esc(t('gate.step_profile'))}</h2>${profileFields()}
        <button data-act="finish-profile" class="big">${esc(t('gate.enter'))}</button>`;
      return;
    }
    if (!state.faction) {
      body.innerHTML = `<h1>${esc(t('gate.welcome'))}</h1>
        <h2>1. ${esc(t('gate.step_profile'))}</h2>${profileFields()}
        <h2>2. ${esc(t('gate.step_faction'))}</h2>${noFactionHtml()}
        <button data-act="logout" class="link">${esc(t('acc.logout'))}</button>`;
      return;
    }
    const tabs = `<nav class="tabs">
      <button data-act="tab" data-tab="faction" class="${state.tab === 'faction' ? 'active' : ''}">${esc(t('vote.tab_faction'))}</button>
      <button data-act="tab" data-tab="votes" class="${state.tab === 'votes' ? 'active' : ''}">${esc(t('vote.tab'))}</button></nav>`;
    body.innerHTML = tabs + (state.tab === 'votes' ? votesHtml() : profileHtml() + factionHtml());
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

  function noFactionHtml() {
    const join = `<div class="choice"><h3>${esc(t('acc.join_title'))}</h3>
      <label>${esc(t('acc.invite_code'))} <input id="j-code" value="${esc(state.invite)}"></label>
      <p class="hint">${esc(t('gate.join_hint'))}</p>
      <button data-act="join">${esc(t('acc.join'))}</button></div>`;
    const create = `<div class="choice"><h3>${esc(t('acc.create_title'))}</h3>
      <label>${esc(t('acc.faction_name'))} <input id="c-name" maxlength="40"></label>
      <label>${esc(t('acc.governance'))} <select id="c-gov">${governanceOptions('authoritarian')}</select></label>
      <p class="hint">${esc(t('acc.governance_hint'))}</p>
      <button data-act="create">${esc(t('acc.create'))}</button></div>`;
    return `<div class="choices">${state.invite ? join + create : create + join}</div>`;
  }

  function factionHtml() {
    const f = state.faction;
    const discord = /^https:\/\/(discord\.gg|discord\.com\/invite)\//.test(f.discord_invite ?? '')
      ? `<a class="button discord" href="${esc(f.discord_invite)}" target="_blank" rel="noopener">${esc(t('acc.join_discord'))}</a>` : '';
    let html = `<h2><i class="swatch" style="background:${esc(f.color)}"></i> ${esc(f.name)}</h2>
      <p class="hint">${esc(t('gov.' + f.governance))} · ${esc(t('acc.my_role'))} : ${esc(t('role.' + state.membership.role))}
      ${state.parent ? ` · ${esc(t('acc.split_from'))} ${esc(state.parent.name)}` : ''}</p>
      ${f.description ? `<p class="desc">${esc(f.description)}</p>` : ''}
      ${discord}`;

    if (isCreator()) html += manageHtml(f);
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
      <fieldset><legend>${esc(t('acc.voting_roles'))}</legend>${voting}</fieldset>
      <label class="inline">${esc(t('vote.hours'))} <input id="f-hours" type="number" min="1" max="336" value="${f.vote_hours ?? 48}"></label>
      <label class="inline">${esc(t('vote.inactivity'))} <input id="f-inact" type="number" min="3" max="90" value="${f.inactivity_days ?? 14}"></label>
      <button data-act="save-faction">${esc(t('acc.save'))}</button>
      <h3>${esc(t('acc.invite_title'))}</h3>
      <label class="inline">${esc(t('acc.invite_days'))} <input id="i-days" type="number" min="1" max="90" value="7"></label>
      <label class="inline">${esc(t('acc.invite_uses'))} <input id="i-uses" type="number" min="1" max="500" value="10"></label>
      <button data-act="invite">${esc(t('acc.invite_create'))}</button>
      <input id="i-link" readonly hidden></details>`;
  }

  function membersHtml() {
    const rows = state.members.map(m => {
      const self = m.profile_id === state.user.id;
      const role = isCreator() && !self
        ? `<select data-member="${m.profile_id}" class="m-role">${ROLES.map(r =>
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
        ${p.created_by === state.user.id || state.membership.role === 'createur'
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
    open() { state.tab = 'faction'; renderPanel(); $('#panel').hidden = false; },
    'open-votes'() { state.tab = 'votes'; renderPanel(); $('#panel').hidden = false; },
    tab(btn) { saveDraft(); state.tab = btn.dataset.tab; renderPanel(); },
    async vote(btn) {
      const ok = await call(sb.rpc('cast_vote', { p_proposal: +btn.dataset.id, p_choice: btn.dataset.choice }));
      if (ok) { await loadProposals(); renderHeader(); renderPanel(); }
    },
    async 'cancel-vote'(btn) {
      if (!confirm(t('vote.cancel_confirm'))) return;
      const ok = await call(sb.rpc('cancel_proposal', { p_proposal: +btn.dataset.id }));
      if (ok) { await loadProposals(); renderHeader(); renderPanel(); drawRaidTargets(); }
    },
    async propose() {
      saveDraft();
      const d = state.draft;
      const kind = d.kind;
      if (['dissolution', 'depose'].includes(kind) && !confirm(t('vote.confirm_' + kind))) return;
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
      if (!confirm(t('acc.kick_confirm'))) return;
      const ok = await call(sb.rpc('kick_member', { p_profile: btn.dataset.member }));
      if (ok) load();
    },
    async leave() {
      if (!confirm(t('acc.leave_confirm'))) return;
      const ok = await call(sb.rpc('leave_faction'));
      if (ok) { say(t('acc.left')); load(); }
    },
    async split() {
      if (!confirm(t('acc.split_confirm'))) return;
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
    if (!e.target.matches('.m-role')) return;
    const role = e.target.value;
    if (role === 'createur' && !confirm(t('acc.transfer_confirm'))) { renderPanel(); return; }
    const ok = await call(sb.rpc('set_member_role', { p_profile: e.target.dataset.member, p_role: role }));
    if (ok) { say(t('acc.saved')); load(); }
  });
  $('#panel-close').addEventListener('click', () => { $('#panel').hidden = true; });

  // ───────── Marqueurs en ligne ─────────
  function canPlaceMarker() {
    return !!state.faction && state.membership.role !== 'nouveau';
  }
  function canDelete(m) {
    return state.user && m.faction_id === state.faction?.id &&
      (m.created_by === state.user.id || ['createur', 'architecte'].includes(state.membership.role));
  }

  async function loadMarkers() {
    if (!KFH.map) return;
    const { data } = await sb.from('markers').select('*');
    dbMarkers.splice(0).forEach(l => l.remove());
    for (const m of data ?? []) {
      const layer = KFH.dot(m.x, m.y, KFH.MARKER_STYLES[m.type] ?? KFH.MARKER_STYLES.other, 8)
        .bindTooltip(() => `${esc(m.name)} (${t('marker.' + m.type)})`);
      if (canDelete(m)) {
        layer.bindPopup(() => {
          const div = document.createElement('div');
          div.innerHTML = `<b>${esc(m.name)}</b><br><button>${esc(t('marker.delete'))}</button>`;
          div.querySelector('button').onclick = async () => {
            if (await call(sb.from('markers').delete().eq('id', m.id))) loadMarkers();
          };
          return div;
        });
      }
      layer.addTo(KFH.markerLayer);
      dbMarkers.push(layer);
    }
  }

  KFH.onMarkerPlaced = async m => {
    if (!canPlaceMarker()) return false;
    const ok = await call(sb.from('markers').insert({
      ...m, faction_id: state.faction.id, created_by: state.user.id, visibility: $('#marker-visibility').value
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
  document.addEventListener('kfh:map-ready', () => { loadMarkers(); drawRaidTargets(); });

  (async () => {
    if (state.invite) {
      const { data } = await sb.rpc('invite_info', { p_code: state.invite });
      state.inviteInfo = data?.[0] ?? null;
    }
    load();
  })();
})();
