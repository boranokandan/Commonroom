// Milestones use lifetime activity. Selecting a reward never changes the ledger.
export const rewardCatalog = [
  {id: 'sage', name: 'Sage space', kind: 'theme', threshold: 5, metric: 'tokens', description: 'A calm green study space.'},
  {id: 'lavender', name: 'Lavender space', kind: 'theme', threshold: 15, metric: 'tokens', description: 'A soft purple study space.'},
  {id: 'sunrise', name: 'Sunrise space', kind: 'theme', threshold: 30, metric: 'tokens', description: 'A warm peach study space.'},
  {id: 'learning-together', name: 'Learning Together', kind: 'title', threshold: 1, metric: 'sessions'},
  {id: 'active-learner', name: 'Active Learner', kind: 'title', threshold: 5, metric: 'sessions'},
  {id: 'dedicated-learner', name: 'Dedicated Learner', kind: 'title', threshold: 20, metric: 'sessions'},
  {id: 'helping-hand', name: 'Helping Hand', kind: 'title', threshold: 1, metric: 'thanks'},
  {id: 'peer-teacher', name: 'Peer Teacher', kind: 'title', threshold: 10, metric: 'thanks'},
  {id: 'community-mentor', name: 'Community Mentor', kind: 'title', threshold: 25, metric: 'thanks'},
];

export async function rewardState(db, userId) {
  const stats = await db.prepare(`SELECT
    COALESCE(SUM(amount), 0) AS tokens,
    COALESCE(SUM(CASE WHEN kind='participated' THEN 1 ELSE 0 END), 0) AS sessions,
    COALESCE(SUM(CASE WHEN kind='helped' OR kind LIKE 'helped:%' THEN 1 ELSE 0 END), 0) AS thanks
    FROM token_activity WHERE user_id=?`).bind(userId).first();
  const selected = await db.prepare('SELECT theme,title FROM reward_preferences WHERE user_id=?').bind(userId).first();
  return {
    stats,
    theme: selected?.theme ?? 'default',
    title: selected?.title ?? '',
    rewards: rewardCatalog.map(reward => ({
      ...reward,
      progress: stats[reward.metric],
      unlocked: stats[reward.metric] >= reward.threshold,
    })),
  };
}

export async function rewardApi(request, db, profile) {
  if (request.method === 'GET') return Response.json(await rewardState(db, profile.id), {headers: {'cache-control': 'no-store'}});
  if (request.method !== 'POST') return Response.json({error: 'Method not allowed.'}, {status: 405});
  if (request.headers.get('Origin') !== new URL(request.url).origin) throw [403, 'Cross-site request blocked.'];
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw [415, 'Send JSON.'];
  const raw = await request.text();
  if (raw.length > 1024) throw [413, 'Request too large.'];
  let data;
  try { data = JSON.parse(raw); } catch { throw [400, 'Invalid request.']; }
  if (!data || !['theme', 'title'].includes(data.kind) || typeof data.id !== 'string') throw [400, 'Choose a reward.'];
  const state = await rewardState(db, profile.id);
  const reset = (data.kind === 'theme' && data.id === 'default') || (data.kind === 'title' && data.id === '');
  const reward = state.rewards.find(item => item.id === data.id && item.kind === data.kind);
  if (!reset && !reward?.unlocked) throw [403, 'Reach this milestone before selecting the reward.'];
  await db.prepare('INSERT OR IGNORE INTO reward_preferences(user_id) VALUES(?)').bind(profile.id).run();
  if (data.kind === 'theme') await db.prepare('UPDATE reward_preferences SET theme=? WHERE user_id=?').bind(data.id, profile.id).run();
  else await db.prepare('UPDATE reward_preferences SET title=? WHERE user_id=?').bind(data.id, profile.id).run();
  return Response.json(await rewardState(db, profile.id), {headers: {'cache-control': 'no-store'}});
}
