// Comptes (connexion Discord), profil, faction, membres, invitations et marqueurs en ligne (Supabase).
// Toute la sécurité est côté base (règles RLS + fonctions) : ce fichier ne fait qu'afficher et appeler.
(() => {
  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  const ROLES = ['createur', 'conseiller', 'architecte', 'diplomate', 'milicien', 'citoyen',
    'marchand', 'forgeron', 'fermier', 'mineur', 'medecin', 'eclaireur', 'nouveau'];
  const SITE = location.origin + location.pathname;

  const state = { user: null, profile: null, membership: null, faction: null, parent: null, members: [], history: [], invite: null };
  const dbMarkers = [];

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
          sb.from('memberships').select('profile_id, role, joined_at, profiles(game_name, discord_name)')
            .eq('faction_id', fid).order('joined_at')
        ]);
        state.faction = f.data;
        state.members = mem.data ?? [];
        if (state.faction?.parent_id) {
          state.parent = (await sb.from('factions').select('name').eq('id', state.faction.parent_id).maybeSingle()).data;
        }
      }
    }
    renderHeader();
    renderPanel();
    loadMarkers();
  }

  // ───────── En-tête ─────────
  function renderHeader() {
    const el = $('#auth');
    if (!state.user) {
      el.innerHTML = `<button data-act="login" class="discord">${esc(t('acc.login'))}</button>`;
    } else {
      const who = state.profile?.game_name || state.profile?.discord_name || '?';
      el.innerHTML = `<button data-act="open">${esc(who)} · ${esc(state.faction?.name ?? t('acc.no_faction'))}</button>
        <button data-act="logout">${esc(t('acc.logout'))}</button>`;
    }
    $('#marker-visibility').hidden = !canPlaceMarker();
  }

  // ───────── Panneau ─────────
  function renderPanel() {
    const body = $('#panel-body');
    if (!state.user) {
      body.innerHTML = `<h2>${esc(t('acc.title'))}</h2>
        ${state.invite ? `<p>${esc(t('acc.invite_login'))}</p>` : ''}
        <button data-act="login" class="discord">${esc(t('acc.login'))}</button>`;
      return;
    }
    body.innerHTML = profileHtml() + (state.faction ? factionHtml() : noFactionHtml());
  }

  function profileHtml() {
    const p = state.profile ?? {};
    const old = state.history.map(h => esc(h.old_name)).join(', ');
    return `<h2>${esc(t('acc.profile'))}</h2>
      <label>${esc(t('acc.game_name'))} <input id="p-game" maxlength="40" value="${esc(p.game_name)}"></label>
      <p class="hint">${esc(t('acc.game_name_hint'))}</p>
      <label>${esc(t('acc.discord_name'))} <input id="p-discord" maxlength="40" value="${esc(p.discord_name)}"></label>
      <button data-act="save-profile">${esc(t('acc.save'))}</button>
      ${old ? `<p class="hint">${esc(t('acc.old_names'))} : ${old}</p>` : ''}`;
  }

  function governanceOptions(selected) {
    return ['authoritarian', 'democratic'].map(g =>
      `<option value="${g}" ${g === selected ? 'selected' : ''}>${esc(t('gov.' + g))}</option>`).join('');
  }

  function noFactionHtml() {
    return `<h2>${esc(t('acc.join_title'))}</h2>
      <label>${esc(t('acc.invite_code'))} <input id="j-code" value="${esc(state.invite)}"></label>
      <button data-act="join">${esc(t('acc.join'))}</button>
      <h2>${esc(t('acc.create_title'))}</h2>
      <label>${esc(t('acc.faction_name'))} <input id="c-name" maxlength="40"></label>
      <label>${esc(t('acc.governance'))} <select id="c-gov">${governanceOptions('authoritarian')}</select></label>
      <p class="hint">${esc(t('acc.governance_hint'))}</p>
      <button data-act="create">${esc(t('acc.create'))}</button>`;
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
    open() { $('#panel').hidden = false; },
    async 'save-profile'() {
      const ok = await call(sb.from('profiles').update({
        game_name: $('#p-game').value.trim(), discord_name: $('#p-discord').value.trim()
      }).eq('id', state.user.id));
      if (ok) { say(t('acc.saved')); load(); }
    },
    async create() {
      const ok = await call(sb.rpc('create_faction', { p_name: $('#c-name').value.trim(), p_governance: $('#c-gov').value }));
      if (ok) { say(t('acc.created')); load(); }
    },
    async join() {
      const ok = await call(sb.rpc('join_faction', { p_code: $('#j-code').value.trim() }));
      if (ok) { state.invite = null; sessionStorage.removeItem('kfh-invite'); say(t('acc.joined')); load(); }
    },
    async 'save-faction'() {
      const roles = [...document.querySelectorAll('input[name=vote-role]:checked')].map(i => i.value);
      const ok = await call(sb.from('factions').update({
        color: $('#f-color').value,
        description: $('#f-desc').value.trim() || null,
        discord_invite: $('#f-discord').value.trim() || null,
        voting_roles: roles
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
  document.addEventListener('kfh:map-ready', loadMarkers);

  load().then(() => {
    if (state.invite && !state.faction) $('#panel').hidden = false;
  });
})();
