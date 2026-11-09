// Kenshi Faction Hub — bot Discord (Supabase Edge Function « discord-bot »).
// Une idée de Akumetsu, créée avec Claude.
//
// Reçoit deux sortes d'appels :
//  1. Discord (clics sur les boutons de vote) : signature Ed25519 vérifiée avec la clé publique de l'application.
//  2. La base de données (pg_net) : { type: 'member' | 'proposal' | 'resync', ... }. On relit toujours la base
//     avant d'agir, donc un appel forgé ne peut que relancer une synchronisation déjà autorisée.
//
// Secrets (Supabase → Edge Functions → Secrets) : DISCORD_BOT_TOKEN.
// SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont fournis automatiquement par Supabase.
// Déployer sans vérification JWT (Discord n'envoie pas de jeton Supabase).

import { createClient } from 'npm:@supabase/supabase-js@2';
import nacl from 'npm:tweetnacl@1.0.3';

const PUBLIC_KEY = 'b315f1656f30828642878b8faf37b44a3991137409e745ccd68f23d2209af536';
const SITE = 'https://anjclerc.github.io/kenshi-faction-hub/';
const API = 'https://discord.com/api/v10';
const TOKEN = Deno.env.get('DISCORD_BOT_TOKEN') ?? '';
const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

// ───── Textes ─────
const ROLE_NAMES: Record<string, Record<string, string>> = {
  fr: { createur: 'Créateur', chef: 'Chef', elu: 'Élu', conseiller: 'Conseiller', architecte: 'Architecte', cartographe: 'Cartographe',
        diplomate: 'Diplomate', milicien: 'Milicien', mercenaire: 'Mercenaire', citoyen: 'Citoyen', marchand: 'Marchand', forgeron: 'Forgeron',
        fermier: 'Fermier', mineur: 'Mineur', medecin: 'Médecin', eclaireur: 'Éclaireur', nouveau: 'Nouveau venu' },
  en: { createur: 'Founder', chef: 'Chief', elu: 'Elected', conseiller: 'Councillor', architecte: 'Architect', cartographe: 'Cartographer',
        diplomate: 'Diplomat', milicien: 'Militia', mercenaire: 'Mercenary', citoyen: 'Citizen', marchand: 'Trader', forgeron: 'Smith',
        fermier: 'Farmer', mineur: 'Miner', medecin: 'Medic', eclaireur: 'Scout', nouveau: 'Newcomer' },
  ru: { createur: 'Основатель', chef: 'Вождь', elu: 'Избранный', conseiller: 'Советник', architecte: 'Архитектор', cartographe: 'Картограф',
        diplomate: 'Дипломат', milicien: 'Ополченец', mercenaire: 'Наёмник', citoyen: 'Гражданин', marchand: 'Торговец', forgeron: 'Кузнец',
        fermier: 'Фермер', mineur: 'Шахтёр', medecin: 'Медик', eclaireur: 'Разведчик', nouveau: 'Новичок' }
};
const T: Record<string, Record<string, string>> = {
  fr: { yes: 'Pour', no: 'Contre', abstain: 'Abstention', voted: '✅ Vote enregistré : ', closes: 'Clôture', raid: 'Raid le',
        passed: '✅ Adoptée', rejected: '❌ Rejetée', cancelled: 'Annulée', site: 'Voir sur le site', nolink: '⚠️ Connecte-toi d\'abord sur le site avec ce compte Discord : ',
        err: '⚠️ Vote refusé : ' },
  en: { yes: 'For', no: 'Against', abstain: 'Abstain', voted: '✅ Vote recorded: ', closes: 'Closes', raid: 'Raid on',
        passed: '✅ Passed', rejected: '❌ Rejected', cancelled: 'Cancelled', site: 'Open on the site', nolink: '⚠️ First sign in on the site with this Discord account: ',
        err: '⚠️ Vote refused: ' },
  ru: { yes: 'За', no: 'Против', abstain: 'Воздержаться', voted: '✅ Голос учтён: ', closes: 'Закрытие', raid: 'Рейд',
        passed: '✅ Принято', rejected: '❌ Отклонено', cancelled: 'Отменено', site: 'Открыть на сайте', nolink: '⚠️ Сначала войдите на сайт с этим аккаунтом Discord: ',
        err: '⚠️ Голос не принят: ' }
};
const ERR: Record<string, Record<string, string>> = {
  fr: { no_vote_right: 'ton rôle ne permet pas de voter.', vote_closed: 'ce vote est terminé.', not_found: 'tu n\'es pas dans cette faction.' },
  en: { no_vote_right: 'your role cannot vote.', vote_closed: 'this vote is closed.', not_found: 'you are not in this faction.' },
  ru: { no_vote_right: 'ваша роль не может голосовать.', vote_closed: 'голосование завершено.', not_found: 'вы не в этой фракции.' }
};
const clean = (s: string) => (s ?? '').replace(/[@#<>*_`~|]/g, '').slice(0, 95);

// ───── Appels à l'API Discord ─────
async function discord(method: string, path: string, body?: unknown) {
  const res = await fetch(API + path, {
    method,
    headers: { Authorization: `Bot ${TOKEN}`, 'Content-Type': 'application/json', 'X-Audit-Log-Reason': 'Kenshi Faction Hub' },
    body: body ? JSON.stringify(body) : undefined
  });
  if (res.status === 429) {   // limite de débit : on attend et on réessaie une fois
    const { retry_after = 1 } = await res.json().catch(() => ({}));
    await new Promise(r => setTimeout(r, retry_after * 1000 + 100));
    return discord(method, path, body);
  }
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data };
}
const parseChannel = (url: string) => {
  const m = url?.match(/channels\/(\d+)\/(\d+)/);
  return m ? { guild: m[1], channel: m[2] } : null;
};

// ───── Rôles et surnoms ─────
async function ensureRoles(secrets: any) {
  const ch = parseChannel(secrets.discord_channel);
  if (!ch) return null;
  const names = ROLE_NAMES[secrets.lang] ?? ROLE_NAMES.fr;
  const map: Record<string, string> = { ...(secrets.role_map ?? {}) };
  const existing = (await discord('GET', `/guilds/${ch.guild}/roles`)).data ?? [];
  const ids = new Set(existing.map((r: any) => r.id));
  let changed = false;
  for (const [key, name] of Object.entries(names)) {
    if (map[key] && ids.has(map[key])) continue;
    const found = existing.find((r: any) => r.name === name);
    const role = found ?? (await discord('POST', `/guilds/${ch.guild}/roles`, { name, mentionable: false, hoist: key !== 'nouveau' })).data;
    if (role?.id) { map[key] = role.id; changed = true; }
  }
  if (changed) await db.from('faction_secrets').update({ role_map: map }).eq('faction_id', secrets.faction_id);
  return { guild: ch.guild, map };
}

async function syncMember(profileId: string, factionId: string) {
  const { data: secrets } = await db.from('faction_secrets').select('*').eq('faction_id', factionId).maybeSingle();
  if (!secrets?.discord_channel || !TOKEN) return;
  const { data: discordId } = await db.rpc('bot_discord_id', { p_profile: profileId });
  if (!discordId) return;
  const g = secrets.sync_roles ? await ensureRoles(secrets) : { guild: parseChannel(secrets.discord_channel)?.guild, map: {} };
  if (!g?.guild) return;
  const member = await discord('GET', `/guilds/${g.guild}/members/${discordId}`);
  if (!member.ok) return;   // pas (encore) sur le serveur Discord de la faction
  const { data: m } = await db.from('memberships').select('role').eq('profile_id', profileId).eq('faction_id', factionId).maybeSingle();
  const ours = Object.values(g.map) as string[];
  const keep = (member.data.roles as string[]).filter(r => !ours.includes(r));
  const patch: Record<string, unknown> = {};
  if (secrets.sync_roles) patch.roles = m ? [...keep, g.map[m.role]].filter(Boolean) : keep;
  if (secrets.sync_nick && m) {
    const { data: p } = await db.from('profiles').select('game_name').eq('id', profileId).maybeSingle();
    if (p?.game_name) patch.nick = p.game_name.slice(0, 32);
  }
  if (Object.keys(patch).length) {
    const r = await discord('PATCH', `/guilds/${g.guild}/members/${discordId}`, patch);
    if (!r.ok && patch.nick) {   // le propriétaire du serveur ne peut pas être renommé : on réessaie sans le surnom
      delete patch.nick;
      if (patch.roles) await discord('PATCH', `/guilds/${g.guild}/members/${discordId}`, patch);
    }
  }
}

async function resync(factionId: string) {
  const { data: members } = await db.from('memberships').select('profile_id').eq('faction_id', factionId);
  for (const m of members ?? []) await syncMember(m.profile_id, factionId);
}

// ───── Votes dans le salon (forum ou texte) ─────
function proposalMessage(p: any, lang: string) {
  const t = T[lang] ?? T.fr;
  const head = p.kind === 'raid' && p.event_at
    ? `⚔️ ${t.raid} <t:${Math.floor(new Date(p.event_at).getTime() / 1000)}:F>`
    : `🗳️ ${t.closes} <t:${Math.floor(new Date(p.closes_at).getTime() / 1000)}:R>`;
  const status = p.status === 'open' ? '' : `\n**${t[p.status] ?? p.status}**`;
  const content = `**${clean(p.title)}**\n${p.description ? clean(p.description).slice(0, 900) + '\n' : ''}${head}\n` +
    `👍 ${p.yes_count} · 👎 ${p.no_count} · ⚪ ${p.abstain_count}${status}`;
  const buttons = p.status === 'open' ? [{
    type: 1, components: [
      { type: 2, style: 3, label: t.yes, custom_id: `v:${p.id}:yes` },
      { type: 2, style: 4, label: t.no, custom_id: `v:${p.id}:no` },
      { type: 2, style: 2, label: t.abstain, custom_id: `v:${p.id}:abstain` },
      { type: 2, style: 5, label: t.site, url: SITE }
    ]
  }] : [{ type: 1, components: [{ type: 2, style: 5, label: t.site, url: SITE }] }];
  return { content, components: buttons, allowed_mentions: { parse: [] } };
}

async function syncProposal(id: number) {
  const { data: p } = await db.from('proposals').select('*').eq('id', id).maybeSingle();
  if (!p || !TOKEN) return;
  const { data: secrets } = await db.from('faction_secrets').select('*').eq('faction_id', p.faction_id).maybeSingle();
  const ch = parseChannel(secrets?.discord_channel);
  if (!ch) return;
  const msg = proposalMessage(p, secrets.lang);
  if (p.discord_message) {   // mise à jour des totaux / du résultat
    const [channelId, messageId] = p.discord_message.split('/');
    await discord('PATCH', `/channels/${channelId}/messages/${messageId}`, msg);
    return;
  }
  if (p.status !== 'open') return;
  // Salon forum : un fil par proposition ; sinon un simple message.
  let r = await discord('POST', `/channels/${ch.channel}/threads`, { name: clean(p.title).slice(0, 90) || 'Vote', message: msg });
  let ref = r.ok ? `${r.data.id}/${r.data.id}` : null;   // dans un forum, le 1er message a l'id du fil
  if (!r.ok) {
    r = await discord('POST', `/channels/${ch.channel}/messages`, msg);
    if (r.ok) ref = `${ch.channel}/${r.data.id}`;
  }
  if (ref) await db.from('proposals').update({ discord_message: ref }).eq('id', id);
}

// ───── Clic sur un bouton ─────
async function onComponent(body: any) {
  const lang = (body.locale ?? 'fr').slice(0, 2);
  const t = T[lang] ?? T.en;
  const reply = (content: string) => json({ type: 4, data: { content, flags: 64 } });
  const [kind, id, choice] = String(body.data?.custom_id ?? '').split(':');
  if (kind !== 'v') return reply('?');
  const discordId = body.member?.user?.id ?? body.user?.id;
  const { data: profileId } = await db.rpc('bot_profile_by_discord', { p_discord: discordId });
  if (!profileId) return reply(t.nolink + SITE);
  const { error } = await db.rpc('cast_vote_as', { p_profile: profileId, p_proposal: +id, p_choice: choice });
  if (error) return reply(t.err + ((ERR[lang] ?? ERR.en)[error.message] ?? error.message));
  return reply(t.voted + t[choice]);
}

// ───── Point d'entrée ─────
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });
const hex = (s: string) => new Uint8Array(s.match(/.{1,2}/g)!.map(b => parseInt(b, 16)));

Deno.serve(async req => {
  if (req.method !== 'POST') return new Response('Kenshi Faction Hub bot', { status: 200 });
  const raw = await req.text();
  const sig = req.headers.get('X-Signature-Ed25519');
  const ts = req.headers.get('X-Signature-Timestamp');

  if (sig && ts) {   // appel de Discord
    const valid = nacl.sign.detached.verify(new TextEncoder().encode(ts + raw), hex(sig), hex(PUBLIC_KEY));
    if (!valid) return new Response('invalid request signature', { status: 401 });
    const body = JSON.parse(raw);
    if (body.type === 1) return json({ type: 1 });   // PING de vérification
    if (body.type === 3) return onComponent(body);
    return json({ type: 4, data: { content: '?', flags: 64 } });
  }

  // appel de la base de données
  let body: any;
  try { body = JSON.parse(raw); } catch { return new Response('bad request', { status: 400 }); }
  try {
    if (body.type === 'member') await syncMember(body.profile_id, body.faction_id);
    else if (body.type === 'proposal') await syncProposal(+body.id);
    else if (body.type === 'resync') await resync(body.faction_id);
  } catch (e) {
    console.error(e);
  }
  return json({ ok: true });
});
