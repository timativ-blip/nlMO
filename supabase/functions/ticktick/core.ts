export const readScope = "tasks:read";
const apiBase = "https://api.ticktick.com";
export const syncPeriodMs = 15 * 60 * 1000;
export const maxProjects = 20;
const projectPattern = /^[a-zA-Z0-9_-]{1,96}$/;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface Project { id: string; name: string }
export interface ImportedTask {
  id: string;
  project: string;
  title: string;
  description: string;
  dueDay: string | null;
  status: "active" | "completed";
  priority: number;
}

export class TickTickError extends Error {
  constructor(public status: number) {
    super("TickTick returned " + status);
  }
}

export async function openTokenKey(secret: string) {
  if (!/^[a-f0-9]{64}$/i.test(secret)) throw new Error("Invalid encryption key");
  const bytes = Uint8Array.from(secret.match(/../g)!, (hex) => parseInt(hex, 16));
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function sealToken(key: CryptoKey, token: string, owner: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const buffer = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: encoder.encode(owner) }, key, encoder.encode(token));
  return btoa(String.fromCharCode(...iv, ...new Uint8Array(buffer)));
}

export async function openToken(key: CryptoKey, ciphertext: string, owner: string) {
  const bytes = Uint8Array.from(atob(ciphertext), (char) => char.charCodeAt(0));
  return decoder.decode(await crypto.subtle.decrypt({
    name: "AES-GCM", iv: bytes.slice(0, 12), additionalData: encoder.encode(owner),
  }, key, bytes.slice(12)));
}

export async function stateHash(state: string) {
  const bytes = await crypto.subtle.digest("SHA-256", encoder.encode(state));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function authorizationUrl(clientId: string, callback: string, state: string) {
  const url = new URL("https://ticktick.com/oauth/authorize");
  url.search = new URLSearchParams({
    client_id: clientId, redirect_uri: callback, response_type: "code", scope: readScope, state,
  }).toString();
  return url.href;
}

export async function exchangeCode(clientId: string, clientSecret: string, callback: string, code: string, send = fetch) {
  const response = await send("https://ticktick.com/oauth/token", {
    method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(10000),
    headers: { authorization: "Basic " + btoa(clientId + ":" + clientSecret), "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, grant_type: "authorization_code", scope: readScope, redirect_uri: callback }),
  });
  if (!response.ok) throw new TickTickError(response.status);
  const token = (await response.json()).access_token;
  if (typeof token !== "string" || token.length < 1 || token.length > 4096) throw new Error("Invalid token response");
  return token;
}

async function request(path: string, token: string, send: typeof fetch, body?: unknown) {
  const response = await send(apiBase + path, {
    method: body === undefined ? "GET" : "POST", redirect: "error", cache: "no-store",
    headers: { authorization: "Bearer " + token, "content-type": "application/json" },
    signal: AbortSignal.timeout(10000),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new TickTickError(response.status);
  return response.json();
}

export async function projectsFor(token: string, send = fetch): Promise<Project[]> {
  const projects = await request("/open/v1/project", token, send);
  if (!Array.isArray(projects)) throw new Error("Invalid project response");
  return projects.flatMap((project) => {
    if (!project || typeof project.id !== "string" || !projectPattern.test(project.id)
        || typeof project.name !== "string" || project.closed || project.kind === "NOTE") return [];
    return [{ id: project.id, name: project.name.slice(0, 150) }];
  });
}

export function selectedProjects(value: unknown, allowed: Project[]) {
  if (!Array.isArray(value) || value.length > maxProjects
      || value.some((id) => typeof id !== "string" || !allowed.some((project) => project.id === id))) {
    throw new Error("Выберите до 20 доступных списков TickTick.");
  }
  return [...new Set<string>(value)];
}

export async function importTasks(token: string, selected: string[], now = new Date(), send = fetch): Promise<ImportedTask[]> {
  if (!selected.length) return [];
  const lists = (await projectsFor(token, send)).filter((project) => selected.includes(project.id));
  if (!lists.length) return [];
  const byId = new Map<string, ImportedTask>();

  function add(tasks: unknown, project: Project, status: ImportedTask["status"]) {
    if (!Array.isArray(tasks)) throw new Error("Invalid task response");
    for (const task of tasks) {
      if (!task || task.projectId !== project.id || typeof task.id !== "string"
          || typeof task.title !== "string" || task.kind === "NOTE") continue;
      const key = project.id + "/" + task.id;
      if (byId.has(key)) continue;
      const dueDay = typeof task.dueDate === "string" && /^\d{4}-\d{2}-\d{2}/.test(task.dueDate)
        ? task.dueDate.slice(0, 10) : null;
      byId.set(key, {
        id: key, project: project.name, title: task.title.slice(0, 250),
        description: typeof task.content === "string" ? task.content.slice(0, 2000) : "",
        dueDay, status, priority: [0, 1, 3, 5].includes(task.priority) ? task.priority : 0,
      });
    }
  }

  const completed = request("/open/v1/task/completed", token, send, {
    projectIds: lists.map((project) => project.id),
    startDate: new Date(now.getTime() - 30 * 86400000).toISOString().replace("Z", "+0000"),
    endDate: now.toISOString().replace("Z", "+0000"),
  });
  // Queue at most five requests per account at once.
  const active = (async () => {
    for (let offset = 0; offset < lists.length; offset += 5) {
      await Promise.all(lists.slice(offset, offset + 5).map(async (project) => {
        const data = await request("/open/v1/project/" + encodeURIComponent(project.id) + "/data", token, send);
        add(data?.tasks, project, "active");
      }));
    }
  })();
  const [history] = await Promise.all([completed, active]);
  if (!Array.isArray(history)) throw new Error("Invalid completion history");
  for (const project of lists) add(history, project, "completed");
  return [...byId.values()].sort((a, b) => a.status.localeCompare(b.status)
    || (a.dueDay ?? "9999").localeCompare(b.dueDay ?? "9999") || a.title.localeCompare(b.title, "ru"));
}

export async function revokeToken(token: string, send = fetch) {
  const response = await send(apiBase + "/oauth/revoke", {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(8000),
    headers: { "content-type": "application/x-www-form-urlencoded", authorization: "Bearer " + token },
    body: new URLSearchParams({ token }),
  });
  await response.body?.cancel();
  return response.ok || response.status === 401;
}
