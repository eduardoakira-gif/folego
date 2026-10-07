// Cliente Pluggy (Open Finance) + sincronização de um "item" (conexão bancária)
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { env } from "./supabase.ts";
import { ingestBatch, type NewTx } from "./store.ts";
import { SAME_OWNER } from "./parse.ts";

const BASE = "https://api.pluggy.ai";
let cached: { key: string; exp: number } | null = null;

async function apiKey(): Promise<string> {
  if (cached && cached.exp > Date.now()) return cached.key;
  const res = await fetch(`${BASE}/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientId: env("PLUGGY_CLIENT_ID"), clientSecret: env("PLUGGY_CLIENT_SECRET") }),
  });
  if (!res.ok) throw new Error(`Pluggy auth falhou: ${res.status}`);
  const { apiKey } = await res.json();
  cached = { key: apiKey, exp: Date.now() + 100 * 60_000 }; // a chave vale 2h
  return apiKey;
}

export async function pluggy<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "X-API-KEY": await apiKey(), "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`Pluggy ${path}: ${res.status} ${await res.text()}`);
  return res.status === 204 ? (undefined as T) : res.json();
}

export function webhookUrl() {
  return `${env("SUPABASE_URL")}/functions/v1/pluggy-webhook?secret=${env("PLUGGY_WEBHOOK_SECRET")}`;
}

/**
 * Muitos bancos mandam só a data (meia-noite UTC = 21h do dia anterior em Brasília).
 * Nesses casos fixamos 12h de Brasília para a compra cair no dia certo.
 */
export function normalizeBankDate(raw: string): string {
  const d = new Date(raw);
  const hhmm = d.toISOString().slice(11, 16);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw) || hhmm === "00:00" || hhmm === "03:00") {
    return `${d.toISOString().slice(0, 10)}T15:00:00.000Z`;
  }
  return d.toISOString();
}

const doc = (p: any) => String(p?.documentNumber?.value ?? p?.documentNumber ?? "").replace(/\D/g, "");

export function toNewTx(t: any, account: { id: string; type: string }): NewTx {
  const text = `${t.description ?? ""} ${t.category ?? ""}`;
  let type: NewTx["type"] = t.type === "CREDIT" ? "income" : "expense";
  if (SAME_OWNER.test(text)) type = "transfer";
  // Pix/TED em que pagador e recebedor têm o mesmo CPF = dinheiro mudando de banco
  const payer = doc(t.paymentData?.payer), receiver = doc(t.paymentData?.receiver);
  if (payer.length >= 11 && payer === receiver) type = "transfer";
  // No cartão, um crédito é pagamento de fatura (transfer) ou estorno (entrada)
  if (account.type === "CREDIT" && t.type === "CREDIT" && !/estorno|refund|cashback|devolu/i.test(text)) type = "transfer";

  const cc = t.creditCardMetadata;
  const counterpart = t.type === "CREDIT" ? t.paymentData?.payer?.name : t.paymentData?.receiver?.name;
  const merchant = t.merchant?.businessName || t.merchant?.name || counterpart || null;
  return {
    source: "open_finance",
    type,
    amount: Math.round(Math.abs(Number(t.amount)) * 100) / 100,
    description: (t.description || merchant || "Transação").trim(),
    merchant,
    occurred_at: normalizeBankDate(t.date),
    external_id: t.id,
    account_id: account.id,
    status: t.status === "PENDING" ? "pending" : "confirmed",
    installment: cc?.totalInstallments > 1 ? `${cc.installmentNumber}/${cc.totalInstallments}` : null,
    providerCategory: t.category ?? null,
    raw: { id: t.id, description: t.description, descriptionRaw: t.descriptionRaw, category: t.category, type: t.type, amount: t.amount },
  };
}

/** Busca contas e transações novas do item e grava. Idempotente. */
export async function syncItem(db: SupabaseClient, itemId: string) {
  const { data: conn } = await db.from("bank_connections").select("*").eq("pluggy_item_id", itemId).single();
  if (!conn) return { ok: false as const, reason: "conexão desconhecida", user_id: null as string | null };

  const item = await pluggy(`/items/${itemId}`);
  await db.from("bank_connections").update({
    status: item.status, status_detail: item.error?.message ?? item.executionStatus ?? null,
    institution: item.connector?.name ?? conn.institution, institution_logo: item.connector?.imageUrl ?? conn.institution_logo,
  }).eq("id", conn.id);

  const { results: accounts } = await pluggy<{ results: any[] }>(`/accounts?itemId=${itemId}`);
  const from = new Date(conn.last_sync_at ? Date.parse(conn.last_sync_at) - 10 * 86_400_000 : Date.now() - 90 * 86_400_000)
    .toISOString().slice(0, 10);

  let total = { inserted: 0, merged: 0, skipped: 0, ids: [] as string[] };
  for (const a of accounts) {
    const { data: acc } = await db.from("accounts").upsert({
      user_id: conn.user_id, connection_id: conn.id, pluggy_account_id: a.id,
      name: a.marketingName || a.name, type: a.type, subtype: a.subtype, balance: a.balance,
      credit_limit: a.creditData?.creditLimit ?? null,
      bill_due_date: a.creditData?.balanceDueDate?.slice(0, 10) ?? null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "pluggy_account_id" }).select("id,type").single();
    if (!acc) continue;

    const txs: NewTx[] = [];
    for (let page = 1; ; page++) {
      const r = await pluggy<{ results: any[]; totalPages: number }>(
        `/transactions?accountId=${a.id}&from=${from}&pageSize=500&page=${page}`,
      );
      txs.push(...r.results.map((t) => toNewTx(t, acc)));
      if (page >= (r.totalPages ?? 1)) break;
    }
    const res = await ingestBatch(db, conn.user_id, txs);
    total = { inserted: total.inserted + res.inserted, merged: total.merged + res.merged, skipped: total.skipped + res.skipped, ids: total.ids.concat(res.ids) };
  }

  // Pix entre bancos próprios conectados: vira transferência (não é gasto nem renda)
  await db.rpc("detect_internal_transfers", { p_user: conn.user_id });
  // Lançamentos "pendentes" que o banco removeu e não confirmou em 5 dias = compra cancelada
  await db.from("transactions").update({ deleted_at: new Date().toISOString(), note: "Pendente cancelado pelo banco" })
    .eq("user_id", conn.user_id).eq("source", "open_finance").eq("status", "pending").is("external_id", null)
    .is("deleted_at", null).lt("updated_at", new Date(Date.now() - 5 * 86_400_000).toISOString());

  await db.from("bank_connections").update({ last_sync_at: new Date().toISOString() }).eq("id", conn.id);
  return { ok: true as const, user_id: conn.user_id as string, ...total };
}
