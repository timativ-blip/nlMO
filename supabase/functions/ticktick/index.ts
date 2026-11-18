import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import {
  authorizationUrl, exchangeCode, importTasks, openToken, openTokenKey, projectsFor,
  revokeToken, sealToken, selectedProjects, stateHash, syncPeriodMs, TickTickError,
} from "./core.ts";
import type { ImportedTask } from "./core.ts";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const site = "https://timativ-blip.github.io/nlMO/";
const callback = "https://nlmo-api.vercel.app/functions/v1/ticktick/callback";
const clientId = Deno.env.get("TICKTICK_CLIENT_ID") ?? "";
const clientSecret = Deno.env.get("TICKTICK_CLIENT_SECRET") ?? "";
const encryptionSecret = Deno.env.get("TICKTICK_TOKEN_KEY") ?? "";
const ready = Boolean(clientId && clientSecret && /^[a-f0-9]{64}$/i.test(encryptionSecret));
const cors = {
  "access-control-allow-origin": new URL(site).origin,
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "cache-control": "private, no-store",
  "referrer-policy": "no-referrer",
};
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { ...cors, "content-type": "application/json; charset=utf-8" },
});
const back = (result: string, params: Record<string, string> = {}) => new Response(null, {
  status: 303, headers: { ...cors, location: site + "#/settings?" + new URLSearchParams({ ticktick: result, ...params }) },
});
type Connection = {
  user_id: string;
  token_ciphertext: string;
  generation: string;
  projects: string[];
  tasks: ImportedTask[];
  synced_at: string | null;
  sync_error: string;
  lease_id: string;
};

function active(profile: { role?: string; active?: boolean; pending?: boolean } | null) {
  return Boolean(profile && ["head", "coordinator", "staff"].includes(profile.role ?? "")
    && profile.active !== false && !profile.pending);
}

async function authorize(request: Request) {
  const token = request.headers.get("authorization")?.match(/^Bearer (\S+)$/i)?.[1];
  if (!token) return null;
  const { data } = await admin.auth.getUser(token);
  if (!data.user) return null;
  const { data: profile } = await admin.from("profiles").select("data").eq("id", data.user.id).maybeSingle();
  return active(profile?.data) ? data.user.id : null;
}

async function getConnection(user: string) {
  const { data, error } = await admin.from("ticktick_connections").select("*").eq("user_id", user).maybeSingle();
  if (error) throw error;
  return data as Connection | null;
}

function snapshot(connection: Connection | null) {
  return {
    ready, connected: Boolean(connection), selected: connection?.projects ?? [],
    tasks: connection?.tasks ?? [], syncedAt: connection?.synced_at ?? null, error: connection?.sync_error ?? "",
  };
}

async function updateSync(connection: Connection, values: Record<string, unknown>) {
  const { error } = await admin.from("ticktick_connections").update({
    ...values, lease_id: null, lease_until: null,
  }).eq("user_id", connection.user_id).eq("generation", connection.generation).eq("lease_id", connection.lease_id);
  if (error) throw error;
}

async function sync(user: string | null) {
  if (!ready) return;
  const { data, error } = await admin.rpc("ticktick_claim_sync", { p_user: user });
  if (error) throw error;
  const key = await openTokenKey(encryptionSecret);
  await Promise.all((data as Connection[] ?? []).map(async (connection) => {
    try {
      const token = await openToken(key, connection.token_ciphertext, connection.user_id);
      const tasks = await importTasks(token, connection.projects);
      const now = new Date();
      await updateSync(connection, {
        tasks, synced_at: now.toISOString(), next_sync_at: new Date(now.getTime() + syncPeriodMs).toISOString(), sync_error: "",
      });
    } catch (error) {
      const status = error instanceof TickTickError ? error.status : 0;
      await updateSync(connection, {
        // Keep the last good snapshot when the provider is temporarily unavailable.
        sync_error: [401, 403].includes(status) ? "reconnect" : "unavailable",
        next_sync_at: new Date(Date.now() + (status === 429 ? syncPeriodMs : 5 * 60 * 1000)).toISOString(),
      });
    }
  }));
}

async function finishLink(user: string, state: unknown, code: unknown) {
  if (typeof state !== "string" || !/^[a-f0-9]{64}$/.test(state)
      || typeof code !== "string" || !code || code.length > 2048) {
    return json({ requestError: "Время подключения истекло. Повторите попытку." });
  }
  const hash = await stateHash(state);
  const { data, error } = await admin.from("ticktick_oauth_states").update({ claimed: true })
    .eq("user_id", user).eq("state_hash", hash).eq("claimed", false)
    .gt("expires_at", new Date().toISOString()).select("user_id").maybeSingle();
  if (error || !data) return json({ requestError: "Время подключения истекло. Повторите попытку." });
  const token = await exchangeCode(clientId, clientSecret, callback, code);
  const encrypted = await sealToken(await openTokenKey(encryptionSecret), token, data.user_id);
  const { data: linked, error: linkError } = await admin.rpc("ticktick_finish_link", { p_state_hash: hash, p_ciphertext: encrypted });
  if (linkError || !linked) {
    await revokeToken(token).catch(() => {});
    return json({ requestError: "Время подключения истекло. Повторите попытку." });
  }
  return json(snapshot(await getConnection(user)));
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname.endsWith("/ticktick/callback")) {
    const code = url.searchParams.get("code"), state = url.searchParams.get("state");
    if (url.searchParams.has("error")) return back("cancelled");
    if (!ready || !state || !/^[a-f0-9]{64}$/.test(state) || !code || code.length > 2048) return back("expired");
    // The callback carries the code in the URL fragment. Only the originating
    // browser with the same workspace session can exchange it.
    return back("confirm", { state, code });
  }
  if (request.method !== "POST") return json({ error: "Недоступный метод." }, 405);
  try {
    const raw = await request.text();
    if (raw.length > 4096) return json({ error: "Запрос слишком большой." }, 413);
    const { action, projects, state, code } = JSON.parse(raw);
    if (action === "dispatch") {
      const { data, error } = await admin.from("app_secrets").select("value").eq("key", "hook_secret").maybeSingle();
      if (error || !data?.value || request.headers.get("x-hook-secret") !== data.value) return json({ error: "Нет доступа." }, 403);
      await sync(null);
      return json({ ok: true });
    }
    const user = await authorize(request);
    if (!user) return json({ error: "Откройте рабочий кабинет и войдите в систему." }, 401);
    if (action === "status") return json(snapshot(await getConnection(user)));
    if (!ready && action !== "disconnect") return json({ requestError: "Подключение TickTick пока не настроено." });

    if (action === "complete") return await finishLink(user, state, code);
    if (action === "start") {
      const state = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
      const { error } = await admin.from("ticktick_oauth_states").upsert({
        user_id: user, state_hash: await stateHash(state), claimed: false,
        expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      }, { onConflict: "user_id" });
      if (error) throw error;
      return json({ authorizationUrl: authorizationUrl(clientId, callback, state) });
    }
    if (action === "disconnect") {
      const { data, error } = await admin.rpc("ticktick_disconnect", { p_user: user });
      if (error) throw error;
      let revoked = true;
      if (data) {
        try {
          const token = await openToken(await openTokenKey(encryptionSecret), data, user);
          revoked = await revokeToken(token);
        } catch { revoked = false; }
      }
      return json({ ...snapshot(null), revoked });
    }
    const connection = await getConnection(user);
    if (!connection) return json({ requestError: "Сначала подключите TickTick." });
    if (action === "sync") {
      await sync(user);
      return json(snapshot(await getConnection(user)));
    }
    if (action !== "projects" && action !== "save") return json({ requestError: "Неизвестное действие." });
    const token = await openToken(await openTokenKey(encryptionSecret), connection.token_ciphertext, user);
    let available;
    try {
      available = await projectsFor(token);
    } catch (error) {
      if (error instanceof TickTickError && [401, 403].includes(error.status)) {
        await admin.from("ticktick_connections").update({ sync_error: "reconnect" }).eq("user_id", user).eq("generation", connection.generation);
        return json({ ...snapshot(connection), error: "reconnect" });
      }
      throw error;
    }
    if (action === "projects") return json({ ...snapshot(connection), projects: available });
    let chosen;
    try { chosen = selectedProjects(projects, available); } catch (error) {
      return json({ requestError: (error as Error).message });
    }
    const { data, error } = await admin.from("ticktick_connections").update({
      projects: chosen, tasks: [], synced_at: null, next_sync_at: new Date().toISOString(),
      generation: crypto.randomUUID(), lease_id: null, lease_until: null, sync_error: "",
    }).eq("user_id", user).eq("generation", connection.generation).select("user_id").maybeSingle();
    if (error) throw error;
    if (!data) return json({ requestError: "Подключение изменилось. Обновите страницу." });
    return json({ ...snapshot(await getConnection(user)), projects: available });
  } catch {
    return json({ requestError: "Не удалось связаться с TickTick. Повторите попытку позже." });
  }
});
