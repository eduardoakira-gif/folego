// Relatórios em texto (WhatsApp). Os números vêm das mesmas funções SQL usadas pelo app.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { brl } from "./supabase.ts";
import { fmtDate } from "./store.ts";

const bar = (pct: number) => {
  const n = Math.max(0, Math.min(10, Math.round(pct / 10)));
  return "▓".repeat(n) + "░".repeat(10 - n);
};

const todayBR = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
export const daysUntil = (d: string) => Math.round((Date.parse(d) - Date.parse(todayBR())) / 86_400_000);
/** "sexta, 7/11" */
export const weekday = (d: string) =>
  new Date(d + "T12:00:00Z").toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "numeric", timeZone: "UTC" })
    .replace("-feira", "");

export async function snapshot(db: SupabaseClient, userId: string) {
  const { data, error } = await db.rpc("financial_snapshot_for", { p_user: userId });
  if (error) throw error;
  return data as any;
}

export async function summaryText(db: SupabaseClient, userId: string) {
  const s = await snapshot(db, userId);
  const exp = (s.categories as any[]).filter((c) => c.kind === "expense" && c.spent > 0).slice(0, 5);
  const lines = [
    `📊 *Ciclo ${fmtDate(s.cycle_start)} a ${fmtDate(s.cycle_end)}*`,
    `Entradas: ${brl(s.income)}`,
    `Saídas: ${brl(s.expenses)}`,
    s.committed_recurring > 0 ? `Recorrentes ainda por vir: ${brl(s.committed_recurring)}` : "",
    ``,
    `💰 *Pode gastar: ${brl(s.available)}*`,
    `≈ ${brl(s.per_day)} por dia até o salário de ${weekday(s.next_payday)} (${s.days_left} dias)`,
    ``,
    `*Onde mais gastou:*`,
    ...exp.map((c) => `${c.icon} ${c.name}: ${brl(c.spent)}${c.budget ? ` (${c.pct}%)` : ""}`),
  ];
  const soon = (s.card_bills ?? []).filter((b: any) => daysUntil(b.due) <= 10);
  if (soon.length) lines.push(``, ...soon.map((b: any) => `💳 Fatura ${b.institution ?? b.account} de ${brl(b.amount)} vence ${weekday(b.due)}`));
  if (s.pending_review > 0) lines.push(``, `🔎 ${s.pending_review} lançamento(s) para revisar no app`);
  if (s.reimbursable_open > 0) lines.push(`🏢 A reembolsar pela empresa: ${brl(s.reimbursable_open)}`);
  return lines.filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n");
}

export async function budgetText(db: SupabaseClient, userId: string) {
  const s = await snapshot(db, userId);
  const cats = (s.categories as any[]).filter((c) => c.kind === "expense" && c.budget);
  if (!cats.length) return "Você ainda não tem orçamento definido. Ajuste no app em *Orçamento*.";
  return [`🎯 *Orçamento do ciclo* (faltam ${s.days_left} dias)`, "",
    ...cats.map((c) => {
      const icon = c.pct >= 100 ? "🔴" : c.pct >= 80 ? "🟡" : "🟢";
      return `${icon} ${c.icon} ${c.name}\n${bar(c.pct ?? 0)} ${brl(c.spent)} / ${brl(c.budget)}`;
    })].join("\n");
}

export async function periodText(db: SupabaseClient, userId: string, period: "hoje" | "semana" | "mes") {
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  const start = new Date(now);
  if (period === "hoje") start.setHours(0, 0, 0, 0);
  if (period === "semana") { start.setDate(now.getDate() - ((now.getDay() + 6) % 7)); start.setHours(0, 0, 0, 0); }
  if (period === "mes") { start.setDate(1); start.setHours(0, 0, 0, 0); }
  const startIso = new Date(start.getTime() + 3 * 3600_000).toISOString(); // BRT → UTC

  const { data } = await db.from("transactions")
    .select("amount,type,description,merchant,occurred_at,categories(name,icon)")
    .eq("user_id", userId).is("deleted_at", null).gte("occurred_at", startIso)
    .order("occurred_at", { ascending: false });
  const rows = (data ?? []) as any[];
  const out = rows.filter((r) => r.type === "expense");
  const inn = rows.filter((r) => r.type === "income");
  const total = out.reduce((a, r) => a + Number(r.amount), 0);
  const label = { hoje: "hoje", semana: "nesta semana", mes: "neste mês" }[period];
  if (!out.length && !inn.length) return `Nenhuma movimentação ${label}. 🙌`;

  const byCat = new Map<string, number>();
  out.forEach((r) => {
    const k = r.categories ? `${r.categories.icon} ${r.categories.name}` : "❔ Sem categoria";
    byCat.set(k, (byCat.get(k) ?? 0) + Number(r.amount));
  });
  const lines = [`🧾 *Gastos ${label}: ${brl(total)}*`, ""];
  [...byCat.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, v]) => lines.push(`${k}: ${brl(v)}`));
  if (period === "hoje") {
    lines.push("", ...out.slice(0, 10).map((r) => `• ${r.merchant ?? r.description} — ${brl(r.amount)}`));
  }
  if (inn.length) lines.push("", `💵 Entradas ${label}: ${brl(inn.reduce((a, r) => a + Number(r.amount), 0))}`);
  return lines.join("\n");
}

export async function lastText(db: SupabaseClient, userId: string) {
  const { data } = await db.from("transactions")
    .select("amount,type,description,merchant,occurred_at,source,categories(icon)")
    .eq("user_id", userId).is("deleted_at", null).order("occurred_at", { ascending: false }).limit(12);
  if (!data?.length) return "Ainda não há lançamentos.";
  return ["📜 *Últimos lançamentos*", "",
    ...(data as any[]).map((r) => {
      const sign = r.type === "income" ? "+" : r.type === "transfer" ? "↔" : "−";
      return `${new Date(r.occurred_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" })} ${r.categories?.icon ?? "•"} ${r.merchant ?? r.description} ${sign}${brl(r.amount)}`;
    })].join("\n");
}

export async function recurringText(db: SupabaseClient, userId: string) {
  const { data } = await db.rpc("recurring_for", { p_user: userId });
  const rows = (data ?? []) as any[];
  if (!rows.length) return "Ainda não identifiquei gastos recorrentes (preciso de pelo menos 2 meses de histórico).";
  const total = rows.reduce((a, r) => a + Number(r.avg_amount), 0);
  return [`🔁 *Recorrentes detectados: ${brl(total)}/mês*`, "",
    ...rows.map((r) => `• ${r.merchant}: ${brl(r.avg_amount)} — próximo ~${fmtDate(r.next_expected)}`)].join("\n");
}

export async function reimbursableText(db: SupabaseClient, userId: string) {
  const { data } = await db.from("transactions").select("amount,description,merchant,occurred_at")
    .eq("user_id", userId).eq("reimbursable", true).is("reimbursed_at", null).is("deleted_at", null)
    .order("occurred_at");
  if (!data?.length) return "Nenhum gasto da empresa pendente de reembolso. ✅";
  const total = data.reduce((a, r) => a + Number(r.amount), 0);
  return [`🏢 *A reembolsar: ${brl(total)}*`, "",
    ...data.map((r) => `• ${new Date(r.occurred_at).toLocaleDateString("pt-BR")} ${r.merchant ?? r.description} — ${brl(r.amount)}`)].join("\n");
}

/** Contexto compacto para a IA responder perguntas livres. */
export async function aiContext(db: SupabaseClient, userId: string) {
  const s = await snapshot(db, userId);
  const since = new Date(Date.now() - 90 * 86_400_000).toISOString();
  const { data } = await db.from("transactions")
    .select("amount,type,description,merchant,occurred_at,categories(name)")
    .eq("user_id", userId).is("deleted_at", null).gte("occurred_at", since)
    .order("occurred_at", { ascending: false }).limit(400);
  const tx = (data ?? []).map((r: any) =>
    `${r.occurred_at.slice(0, 10)}|${r.type}|${r.amount}|${r.categories?.name ?? "-"}|${(r.merchant ?? r.description).slice(0, 40)}`);
  return { snapshot: s, transactions_90d: tx.join("\n") };
}

/** Tudo o que já está comprometido: faturas, parcelas futuras e contas recorrentes. */
export async function commitmentsText(db: SupabaseClient, userId: string) {
  const s = await snapshot(db, userId);
  const lines = [`📅 *O que ainda vai sair*`, ""];
  const bills = s.card_bills ?? [];
  if (bills.length) {
    lines.push("*Faturas abertas*");
    bills.forEach((b: any) => lines.push(`💳 ${b.institution ?? b.account}: ${brl(b.amount)} — vence ${weekday(b.due)}`));
    lines.push("");
  }
  const inst = s.installments ?? { items: [] };
  if (inst.items?.length) {
    lines.push(`*Parcelas a vencer*: ${brl(inst.next_3_months)} nos próximos 3 meses (${brl(inst.total_remaining)} no total)`);
    inst.items.slice(0, 6).forEach((i: any) => lines.push(`• ${i.label}: ${i.remaining}x de ${brl(i.amount)}`));
    lines.push("");
  }
  const rec = s.recurring ?? [];
  if (rec.length) {
    lines.push(`*Recorrentes*: ${brl(rec.reduce((a: number, r: any) => a + Number(r.avg_amount), 0))}/mês`);
    rec.slice(0, 6).forEach((r: any) => lines.push(`• ${r.merchant}: ${brl(r.avg_amount)} ~${fmtDate(r.next_expected)}`));
  }
  if (lines.length === 2) return "Nada comprometido por enquanto: sem faturas abertas, parcelas ou contas recorrentes detectadas.";
  return lines.join("\n").trim();
}
