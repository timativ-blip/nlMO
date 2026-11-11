import { useEffect, useState } from "react";
import { sb } from "../lib/supabase";
import { withDeadline } from "../lib/deadline";
import { humanError } from "./backend";
import { DEMO_MODE } from "./store";
import type { Attachment } from "./types";
import type { MeetingDocumentContent } from "./communication-types";
export interface Resource {
  id: string;
  kind: "room" | "equipment";
  name: string;
  code: string;
  description: string;
  active: boolean;
}
export interface Reservation {
  id: string;
  resource_id: string;
  borrower_id: string;
  district_id: string | null;
  purpose: string;
  starts_at: string;
  ends_at: string;
  status: "reserved" | "issued" | "returned" | "cancelled";
  issued_at: string | null;
  returned_at: string | null;
  issue_note: string;
  return_note: string;
  updated_by: string;
  version: number;
}
export interface Material {
  id: string;
  parent_id: string | null;
  kind: "folder" | "link";
  name: string;
  url: string;
  description: string;
  archived: boolean;
}
export interface ArchivedMinutes {
  id: string;
  title: string;
  held_at: string;
  owner_id: string;
  responsible_id: string;
  content: MeetingDocumentContent;
  attachments: Attachment[];
  participant_ids: string[];
  version: number;
  published_version: number;
  published_at: string | null;
  can_edit: boolean;
}
export interface HeadquartersIndex {
  resources: Resource[];
  reservations: Reservation[];
  materials: Material[];
  minutes: ArchivedMinutes[];
  serverTime: string;
}
const attempts = new Map<string, string>();
export async function headquartersRpc<T>(
  action: string,
  body: Record<string, unknown> = {},
): Promise<T> {
  if (!sb || DEMO_MODE)
    throw new Error("Этот раздел работает после входа в рабочую систему.");
  const { data: auth } = await sb.auth.getSession();
  const key =
    auth.session?.user.id +
    ":" +
    action +
    ":" +
    JSON.stringify({ ...body, requestId: undefined });
  if (action !== "index" && action !== "ai_access") {
    if (!attempts.has(key))
      attempts.set(key, String(body.requestId ?? crypto.randomUUID()));
    body = { ...body, requestId: attempts.get(key) };
  }
  const { data, error } = await withDeadline(
    (signal) =>
      sb!
        .rpc("headquarters", { p_action: action, p_body: body })
        .abortSignal(signal),
    18000,
    "Не удалось связаться со штабом. Повторите попытку.",
  );
  if (error)
    throw new Error(
      /PGRST202/.test(error.code)
        ? "Раздел ещё подключается. Попробуйте позже."
        : humanError(error.message),
    );
  attempts.delete(key);
  return data as T;
}
export function useHeadquarters() {
  const [data, setData] = useState<HeadquartersIndex | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true,
      loading = false;
    const refresh = async () => {
      if (loading) return;
      loading = true;
      try {
        const value = await headquartersRpc<HeadquartersIndex>("index");
        if (active) {
          setData(value);
          setError("");
        }
      } catch (e) {
        if (active) setError((e as Error).message);
      } finally {
        loading = false;
        if (active) setLoading(false);
      }
    };
    void refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 30000);
    const visible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      active = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [revision]);
  return { data, error, loading, refresh: () => setRevision((x) => x + 1) };
}
export const reservationLabel = (r: Reservation, now = Date.now()) =>
  r.status === "issued"
    ? Date.parse(r.ends_at) < now
      ? "Просрочен возврат"
      : "На руках"
    : r.status === "returned"
      ? "Возвращено"
      : r.status === "cancelled"
        ? "Отменено"
        : Date.parse(r.ends_at) < now
          ? "Бронь истекла"
          : "Забронировано";
export function safeHttps(value: string) {
  try {
    const u = new URL(value);
    return u.protocol === "https:" && !u.username && !u.password ? u.href : "";
  } catch {
    return "";
  }
}
