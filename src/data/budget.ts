import { withDeadline } from "../lib/deadline";
import { sb } from "../lib/supabase";

export interface BudgetFund {
  id: string;
  kind: "district" | "media" | "direction";
  name: string;
  district_id: string | null;
  responsible_id: string | null;
  limit_minor: number;
  issued_minor: number;
  version: number;
}

export interface FundingRequest {
  id: string;
  fund_id: string;
  recipient_id: string;
  amount_minor: number;
  purpose: string;
  status: "pending" | "sent" | "rejected";
  decision_note: string;
  created_at: string;
  decided_at: string | null;
}

export interface Advance {
  id: string;
  recipient_id: string;
  fund_id: string;
  request_id: string | null;
  district_id: string | null;
  purpose: string;
  amount_minor: number;
  issued_on: string;
}

export interface Expense {
  id: string;
  advance_id: string;
  spent_on: string;
  description: string;
  amount_minor: number;
  receipt_path: string;
  receipt_name: string;
  status: "pending" | "accepted" | "returned";
  review_note: string;
  reviewed_at: string | null;
  version: number;
}

const bucket = "budget-receipts";
const maxReceiptBytes = 10 * 1024 * 1024;
const receiptTypes: Record<string, string> = {
  pdf: "application/pdf", jpg: "image/jpeg", png: "image/png",
  webp: "image/webp", heic: "image/heic", heif: "image/heif",
};

export const rubles = (minor: number) =>
  new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB" }).format(minor / 100);

export function amountMinor(input: string, budgetLimit = false) {
  const value = input.trim().replace(/\s+/g, "").replace(",", ".");
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(value)) throw new Error("Введите сумму в рублях с точностью до копеек.");
  const [whole, fraction = ""] = value.split(".");
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  const minimum = budgetLimit ? 0 : 1;
  const maximum = budgetLimit ? 100000000000 : 1000000000;
  if (minor < minimum || minor > maximum) throw new Error("Допустимая сумма: " + rubles(minimum) + " – " + rubles(maximum) + ".");
  return minor;
}

const deadline = "Сервер не ответил. Повторите попытку.";
async function budgetRows<T>(table: string, order: string, signal: AbortSignal): Promise<T[]> {
  const items: T[] = [];
  const pageSize = 200;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await sb!.from(table).select("*")
      .order(order, { ascending: table === "budget_funds" }).order("id")
      .range(offset, offset + pageSize - 1).abortSignal(signal);
    if (error) throw new Error("Не удалось загрузить бюджет и чеки.");
    items.push(...data as T[]);
    if (data.length < pageSize) return items;
  }
}

export async function loadBudget() {
  if (!sb) return { funds: [] as BudgetFund[], requests: [] as FundingRequest[], advances: [] as Advance[], expenses: [] as Expense[] };
  const [funds, requests, advances, expenses] = await withDeadline((signal) => Promise.all([
    budgetRows<BudgetFund>("budget_funds", "name", signal),
    budgetRows<FundingRequest>("budget_requests", "created_at", signal),
    budgetRows<Advance>("budget_advances", "issued_on", signal),
    budgetRows<Expense>("budget_expenses", "spent_on", signal),
  ]), 15000, deadline);
  return { funds, requests, advances, expenses };
}

export async function budgetAction(action: "fund_save" | "request" | "issue" | "mark_sent" | "reject" | "submit" | "review", body: Record<string, unknown>) {
  if (!sb) throw new Error("Бюджет доступен в рабочем кабинете.");
  const { error } = await withDeadline(
    (signal) => sb!.rpc("budget", { p_action: action, p_body: body }).abortSignal(signal),
    17000, deadline,
  );
  if (error) throw new Error(error.code === "23514" ? "Проверьте сумму, дату и описание." : error.message);
}

export function receiptUploadPath(userId: string, expenseId: string, file: File) {
  const extension = file.name.split(".").pop()?.toLowerCase().replace(/^jpeg$/, "jpg") ?? "";
  if (!Object.hasOwn(receiptTypes, extension) || !file.size || file.size > maxReceiptBytes)
    throw new Error("Прикрепите фото чека или PDF размером до 10 МБ.");
  return { path: [userId, expenseId, crypto.randomUUID() + "." + extension].join("/"), type: receiptTypes[extension] };
}

export async function uploadReceipt(file: File, upload: ReturnType<typeof receiptUploadPath>) {
  if (!sb) throw new Error("Бюджет доступен в рабочем кабинете.");
  const { error } = await sb.storage.from(bucket).upload(upload.path, file, { contentType: upload.type });
  if (!error) return;
  // A previously completed upload can be reused after a lost response.
  if ("statusCode" in error && String(error.statusCode) === "409") {
    const { error: probeError } = await sb.storage.from(bucket).createSignedUrl(upload.path, 30);
    if (!probeError) return;
  }
  throw new Error("Не удалось загрузить чек. Повторите попытку.");
}

async function receiptDownload(expense: Expense) {
  const result = await sb?.storage.from(bucket).download(expense.receipt_path);
  if (result?.error || !result?.data) throw new Error("Не удалось скачать чек «" + expense.receipt_name + "».");
  return result.data;
}

export function saveDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function downloadReceipt(expense: Expense) {
  saveDownload(await receiptDownload(expense), expense.receipt_name);
}

export async function exportBudget(fund: BudgetFund, advance: Advance, expenses: Expense[], recipient: string, district: string) {
  const accepted = expenses.filter((e) => e.advance_id === advance.id && e.status === "accepted");
  if (!accepted.length) throw new Error("Выберите принятые расходы для выгрузки.");
  const { zipSync, strToU8 } = await import("fflate");
  const files: Record<string, Uint8Array> = {};
  const records = [];
  let bytes = 0;
  for (const expense of accepted) {
    const receipt = await receiptDownload(expense);
    bytes += receipt.size;
    if (bytes > 100 * 1024 * 1024) throw new Error("Выберите меньше чеков для одного архива.");
    const path = "receipts/" + expense.id + "." + expense.receipt_path.split(".").pop();
    files[path] = new Uint8Array(await receipt.arrayBuffer());
    records.push({
      externalId: expense.id, spentOn: expense.spent_on, description: expense.description,
      amountMinor: expense.amount_minor, acceptedAt: expense.reviewed_at,
      receipt: { file: path, name: expense.receipt_name, contentType: receipt.type },
    });
  }
  files["expenses.json"] = strToU8(JSON.stringify({
    schemaVersion: 1,
    currency: "RUB",
    exportedAt: new Date().toISOString(),
    fund: { externalId: fund.id, kind: fund.kind, name: fund.name },
    advance: {
      externalId: advance.id, requestId: advance.request_id, recipientId: advance.recipient_id, recipient,
      districtId: advance.district_id, district, issuedOn: advance.issued_on,
      purpose: advance.purpose, amountMinor: advance.amount_minor,
    },
    expenses: records,
  }, null, 2));
  const zip = zipSync(files, { level: 0 });
  saveDownload(new Blob([zip], { type: "application/zip" }), "budget-" + advance.issued_on + "-" + advance.id.slice(0, 8) + ".zip");
}
