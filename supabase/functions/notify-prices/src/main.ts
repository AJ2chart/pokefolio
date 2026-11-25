// Supabase Edge Function « notify-prices » (Deno). Two uses:
//  - daily, by the scheduled job (Supabase → Integrations → Cron, 08:00 UTC): price check and notifications (runDaily);
//  - « Send a test » from the app (body {mode:'test'} + the user's session): a test notification to that user's devices.
//  - {mode:'key'}: the public sending key, for the app to subscribe (the key pair is made here on the first call and kept in
//    push_runs, a table only the server can read: no secret to copy anywhere).
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase to every function.
// « Verify JWT » is turned off for this function: the daily run is harmless to call (it runs at most once every 20 h)
// and the test checks the caller's session itself.
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = { 'Access-Control-Allow-Origin': 'https://aj2chart.github.io', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  const env = (k: string) => Deno.env.get(k) || '';
  const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
  const must = <T>(r: { data: T; error: unknown }) => { if (r.error) throw r.error; return r.data; };
  // sending keys: made once, then always the same (changing them would cut every device's subscription)
  let keys = must(await db.from('push_runs').select('vapid_pub,vapid_priv').eq('id', 1).maybeSingle()) as { vapid_pub?: string; vapid_priv?: string } | null;
  if (!keys?.vapid_pub || !keys?.vapid_priv) {
    const made = await makeVapid();
    // two first calls at the same time: only the first pair is kept (update only while empty), both then read it back
    must(await db.from('push_runs').upsert({ id: 1 }, { onConflict: 'id', ignoreDuplicates: true }));
    must(await db.from('push_runs').update({ vapid_pub: made.pub, vapid_priv: made.priv }).eq('id', 1).is('vapid_pub', null));
    keys = must(await db.from('push_runs').select('vapid_pub,vapid_priv').eq('id', 1).maybeSingle()) as { vapid_pub: string; vapid_priv: string };
  }
  const vapid = { pub: keys!.vapid_pub!, subject: 'https://aj2chart.github.io/pokefolio/', key: await vapidKey(keys!.vapid_pub!, keys!.vapid_priv!) };
  const io = {
    now: () => Date.now(),
    sleep: (ms: number) => new Promise(r => setTimeout(r, ms)),
    json: async (url: string, headers: Record<string, string>) => { const r = await fetch(url, { headers }); if (!r.ok) throw new Error(String(r.status)); return r.json(); },
    usdEur: async () => { try { const j = await (await fetch('https://api.frankfurter.app/latest?from=USD&to=EUR')).json(); const r = +j?.rates?.EUR; return r > 0.3 && r < 3 ? r : 0.9; } catch (_) { return 0.9; } },
    getLastRun: async () => { const d = must(await db.from('push_runs').select('last_run').eq('id', 1).maybeSingle()) as { last_run?: string } | null; return d?.last_run ? Date.parse(d.last_run) : 0; },
    setLastRun: async (t: number) => { must(await db.from('push_runs').upsert({ id: 1, last_run: new Date(t).toISOString() })); },
    listSubs: async () => must(await db.from('push_subs').select('endpoint,user_id,p256dh,auth,deal_pct,lang')) as Array<Record<string, string>>,
    getCollections: async (ids: string[]) => { const rows = must(await db.from('user_data').select('user_id,data').in('user_id', ids)) as Array<{ user_id: string; data: { collection?: unknown[] } }>; return new Map(rows.map(r => [r.user_id, r.data?.collection || []])); },
    getStates: async (ids: string[]) => { const rows = must(await db.from('push_state').select('user_id,notified').in('user_id', ids)) as Array<{ user_id: string; notified: Record<string, string> }>; return new Map(rows.map(r => [r.user_id, r.notified || {}])); },
    setState: async (u: string, notified: Record<string, string>) => { must(await db.from('push_state').upsert({ user_id: u, notified, updated_at: new Date().toISOString() })); },
    deleteSub: async (endpoint: string) => { await db.from('push_subs').delete().eq('endpoint', endpoint); },
    send: (s: Record<string, string>, payload: unknown) => sendPush(fetch, s, payload, vapid).catch(() => 0),
  };
  try {
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    if (body?.mode === 'key') return reply({ key: vapid.pub });
    if (body?.mode === 'test') {
      const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
      const { data: u } = await db.auth.getUser(jwt);
      if (!u?.user) return reply({ error: 'not signed in' }, 401);
      const st = must(await db.from('push_state').select('test_at').eq('user_id', u.user.id).maybeSingle()) as { test_at?: string } | null;
      if (st?.test_at && Date.now() - Date.parse(st.test_at) < 60e3) return reply({ error: 'wait' }, 429);
      must(await db.from('push_state').upsert({ user_id: u.user.id, test_at: new Date().toISOString() }));
      return reply(await runTest(io, u.user.id));
    }
    return reply(await runDaily(io));
  } catch (e) { return reply({ error: String((e as Error)?.message || e) }, 500); }
});
