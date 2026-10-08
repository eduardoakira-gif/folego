// Gravação de transações: categorização, deduplicação entre fontes e alertas de orçamento.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { pickCategory, type Category, type Rule } from "./categorize.ts";
import { normalizeMerchant } from "./parse.ts";
import { sendWhatsApp } from "./whatsapp.ts";
import { brl } from "./supabase.ts";

export type NewTx = {
  source: "open_finance" | "notification" | "manual" | "whatsapp" | "import";
  type: "income" | "expense" | "transfer";
  amount: number;
  description: string;
  merchant?: string | null;
  occurred_at: string;              // ISO
  external_id?: string | null;
  account_id?: string | null;
  status?: "pending" | "confirmed";
  installment?: string | null;
  providerCategory?: string | null;
  raw?: unknown;
};

export async function loadCategorizer(db: SupabaseClient, userId: string) {
  const [{ data: cats }, { data: rules }] = await Promise.all([
    db.from("categories").select("id,name,kind").eq("user_id", userId).eq("archived", false),
    db.from("category_rules").select("pattern,category_id,mark_reimbursable").eq("user_id", userId),
  ]);
  return (t: NewTx) =>
    pickCategory(
      { type: t.type, text: `${t.merchant ?? ""} ${t.description}`, providerCategory: t.providerCategory },
      (cats ?? []) as Category[],
      (rules ?? []) as Rule[],
    );
}

const DAY = 86_400_000;
const near = (a: string, b: string, days: number) => Math.abs(Date.parse(a) - Date.parse(b)) <= days * DAY;
/** Dia no horário de Brasília (UTC−3, sem horário de verão desde 2019). */
export const localDay = (iso: string) => new Date(Date.parse(iso) - 3 * 3600_000).toISOString().slice(0, 10);

/**
 * Notificação/WhatsApp chegam ANTES do Open Finance. Quando o banco confirma, juntamos as duas
 * em um registro só (em vez de contar o gasto duas vezes).
 */
type Candidate = { id: string; type: string; amount: number; occurred_at: string; category_locked: boolean; merchant: string | null; source?: string; external_id?: string | null };

export async function ingestBatch(db: SupabaseClient, userId: string, items: NewTx[]) {
  if (!items.length) return { inserted: 0, merged: 0, skipped: 0, ids: [] as string[] };
  const categorize = await loadCategorizer(db, userId);

  const minDate = new Date(Math.min(...items.map((t) => Date.parse(t.occurred_at))) - 5 * DAY).toISOString();

  // já existentes (por id externo)
  const extIds = items.map((t) => t.external_id).filter(Boolean) as string[];
  const existing = new Set<string>();
  for (let i = 0; i < extIds.length; i += 300) {
    const { data } = await db.from("transactions").select("external_id")
      .eq("user_id", userId).in("external_id", extIds.slice(i, i + 300));
    data?.forEach((r) => existing.add(r.external_id));
  }

  // candidatos a junção: lançamentos provisórios (notificação, WhatsApp, manual) e extratos importados
  const { data: candRows } = await db.from("transactions")
    .select("id,type,amount,occurred_at,category_locked,merchant,source,external_id")
    .eq("user_id", userId).is("deleted_at", null).or("external_id.is.null,source.eq.import")
    .gte("occurred_at", minDate);
  const candidates = ((candRows ?? []) as Candidate[]).filter((c) => !c.external_id || c.source === "import");

  // transações recentes de qualquer origem (para não duplicar notificação/extrato)
  let recent: Candidate[] = [];
  if (items.some((t) => !t.external_id || t.source === "import")) {
    const { data } = await db.from("transactions")
      .select("id,type,amount,occurred_at,category_locked,merchant,source,external_id")
      .eq("user_id", userId).is("deleted_at", null).gte("occurred_at", minDate);
    recent = (data ?? []) as Candidate[];
  }
  const sameDay = (a: string, b: string) => localDay(a) === localDay(b);
  // Pix que o banco marcou como transferência pode ter chegado antes pela notificação como gasto
  const typeMatches = (c: Candidate, t: NewTx) => c.type === t.type || (t.type === "transfer" && c.source === "notification");

  const inserts: Record<string, unknown>[] = [];
  let merged = 0, skipped = 0;
  const ids: string[] = [];

  for (const t of items) {
    if (t.external_id && existing.has(t.external_id)) { skipped++; continue; }

    if (t.source === "import") {
      // Extrato: se o mesmo lançamento já veio do Open Finance (mesmo dia, valor e tipo), não duplica.
      // Conta por ocorrência: duas compras iguais no mesmo dia continuam sendo duas.
      const i = recent.findIndex((c) => c.source === "open_finance" && c.external_id && c.type === t.type &&
        Number(c.amount) === t.amount && sameDay(c.occurred_at, t.occurred_at));
      if (i >= 0) { recent.splice(i, 1); skipped++; continue; }
    }

    if (t.external_id) {
      // Open Finance ou extrato: procura lançamento provisório equivalente (mesmo valor/tipo, ±3 dias)
      const idx = candidates.findIndex((c) => c.id && typeMatches(c, t) && Number(c.amount) === t.amount &&
        near(c.occurred_at, t.occurred_at, 3) && !(t.source === "import" && c.source === "import"));
      if (idx >= 0) {
        const c = candidates.splice(idx, 1)[0];
        const patch: Record<string, unknown> = {
          external_id: t.external_id, account_id: t.account_id ?? null, source: t.source, type: t.type,
          status: t.status ?? "confirmed", occurred_at: t.occurred_at,
          description: t.description, merchant: c.merchant ?? t.merchant ?? null,
        };
        if (t.type === "transfer") patch.category_id = null;
        else if (!c.category_locked) {
          const { category_id } = categorize(t);
          if (category_id) patch.category_id = category_id;
        }
        await db.from("transactions").update(patch).eq("id", c.id).eq("user_id", userId);
        merged++; ids.push(c.id);
        continue;
      }
    } else {
      // Notificação/manual: se já existe a mesma movimentação nas últimas 36h, ignora
      const sameMerchant = (a: string | null) =>
        !a || !t.merchant || normalizeMerchant(a).slice(0, 5) === normalizeMerchant(t.merchant).slice(0, 5);
      // Mesma compra avisada por dois apps (ex.: Carteira do Google + app do banco): mesmo valor
      // em até 15 minutos é a mesma movimentação, mesmo que os nomes do estabelecimento difiram.
      const MIN15 = 15 / (24 * 60);
      const dup = t.source === "notification" && recent.find((c) =>
        c.type === t.type && Number(c.amount) === t.amount &&
        (near(c.occurred_at, t.occurred_at, MIN15) || (near(c.occurred_at, t.occurred_at, 1.5) && sameMerchant(c.merchant)))
      );
      if (dup) {
        // aproveita o nome mais legível (a Carteira costuma trazer o nome "bonito" da loja)
        if (!dup.merchant && t.merchant) await db.from("transactions").update({ merchant: t.merchant }).eq("id", dup.id).eq("user_id", userId);
        skipped++; continue;
      }
    }

    const { category_id, reimbursable } = categorize(t);
    const id = crypto.randomUUID();
    inserts.push({
      id, user_id: userId, source: t.source, type: t.type, amount: t.amount,
      description: t.description.slice(0, 200), merchant: t.merchant ?? null,
      occurred_at: t.occurred_at, external_id: t.external_id ?? null, account_id: t.account_id ?? null,
      status: t.status ?? (t.source === "notification" ? "pending" : "confirmed"),
      installment: t.installment ?? null, category_id, reimbursable, raw: t.raw ?? null,
    });
    recent.push({ id, type: t.type, amount: t.amount, occurred_at: t.occurred_at, category_locked: false, merchant: t.merchant ?? null, source: t.source, external_id: t.external_id ?? null });
    ids.push(id);
  }

  for (let i = 0; i < inserts.length; i += 500) {
    const { error } = await db.from("transactions").upsert(inserts.slice(i, i + 500), { onConflict: "user_id,external_id", ignoreDuplicates: true });
    if (error) throw error;
  }
  return { inserted: inserts.length, merged, skipped, ids };
}

/** Avisa no WhatsApp quando uma categoria passa de 80% e de 100% do orçamento do ciclo. */
export async function checkBudgetAlerts(db: SupabaseClient, userId: string) {
  const { data: prof } = await db.from("profiles").select("whatsapp_phone,alerts_enabled").eq("id", userId).single();
  if (!prof?.whatsapp_phone || !prof.alerts_enabled) return;
  const { data: snap } = await db.rpc("financial_snapshot_for", { p_user: userId });
  if (!snap) return;
  const lines: string[] = [];
  for (const c of snap.categories as any[]) {
    if (c.kind !== "expense" || !c.budget || c.pct == null) continue;
    const level = c.pct >= 100 ? 100 : c.pct >= 80 ? 80 : 0;
    if (!level) continue;
    const key = `budget${level}:${c.id}:${snap.cycle_start}`;
    const { error } = await db.from("alerts_sent").insert({ user_id: userId, key });
    if (error) continue; // já avisado neste ciclo
    lines.push(level === 100
      ? `🔴 ${c.icon} ${c.name}: estourou o orçamento (${brl(c.spent)} de ${brl(c.budget)})`
      : `🟡 ${c.icon} ${c.name}: ${c.pct}% do orçamento usado (${brl(c.spent)} de ${brl(c.budget)})`);
  }
  if (lines.length) {
    lines.push(`\nDisponível até ${fmtDate(snap.cycle_end)}: ${brl(snap.available)} (${brl(snap.per_day)}/dia)`);
    await sendWhatsApp(prof.whatsapp_phone, lines.join("\n"));
  }
}

export const fmtDate = (d: string) => new Date(d + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
