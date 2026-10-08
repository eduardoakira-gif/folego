// Bot do WhatsApp (Cloud API oficial).
//  GET  → verificação do webhook pela Meta
//  POST → mensagens recebidas (assinatura X-Hub-Signature-256 validada)
import { admin, brl, env } from "../_shared/supabase.ts";
import { sendWhatsApp, verifyMetaSignature } from "../_shared/whatsapp.ts";
import { parseChatEntry } from "../_shared/parse.ts";
import { checkBudgetAlerts, ingestBatch } from "../_shared/store.ts";
import { downloadWhatsAppMedia, readReceipt, registerReceipt } from "../_shared/receipt.ts";
import { aiContext, budgetText, commitmentsText, lastText, periodText, recurringText, reimbursableText, summaryText } from "../_shared/reports.ts";

const HELP = `👋 *Comandos*
• *resumo* — quanto posso gastar até o próximo salário
• *hoje* / *semana* / *mês* — gastos do período
• *orçamento* — situação de cada categoria
• *últimos* — últimos lançamentos
• *recorrentes* — assinaturas e contas fixas
• *contas* ou *fatura* — contas fixas, faturas, parcelas e tudo que ainda vai sair
• *reembolso* — gastos da empresa a receber
• *gastei 45 mercado* — lança na hora
• *recebi 300 freela* — lança uma entrada
• *desfazer* — apaga o último lançamento feito aqui
• 📎 *mande o print/PDF de um comprovante* (Pix, boleto, nota) — eu leio e lanço sem duplicar. Escreva *empresa* na legenda se for reembolso
Ou pergunte do seu jeito: _"quanto gastei com uber esse mês?"_`;

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (req.method === "GET") {
    if (url.searchParams.get("hub.mode") === "subscribe" && url.searchParams.get("hub.verify_token") === env("WA_VERIFY_TOKEN")) {
      return new Response(url.searchParams.get("hub.challenge") ?? "");
    }
    return new Response("forbidden", { status: 403 });
  }

  const raw = await req.text();
  if (!(await verifyMetaSignature(raw, req.headers.get("x-hub-signature-256")))) {
    return new Response("invalid signature", { status: 401 });
  }
  const payload = JSON.parse(raw);
  const db = admin();

  const jobs: Promise<unknown>[] = [];
  for (const entry of payload.entry ?? []) for (const change of entry.changes ?? []) {
    for (const msg of change.value?.messages ?? []) jobs.push(handleMessage(db, msg).catch((e) => console.error("wa", e)));
  }
  const all = Promise.all(jobs);
  // @ts-ignore EdgeRuntime existe no Supabase
  if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(all); else await all;
  return new Response("ok");
});

async function handleMessage(db: ReturnType<typeof admin>, msg: any) {
  // idempotência: a Meta pode reenviar a mesma mensagem
  const { error: dupErr } = await db.from("inbound_messages").insert({ id: msg.id });
  if (dupErr) return;

  const from: string = msg.from; // E.164 sem "+"
  const text: string = msg.text?.body ?? msg.button?.text ?? msg.interactive?.button_reply?.title ?? "";
  const reply = (t: string) => sendWhatsApp(from, t);

  const { data: prof } = await db.from("profiles").select("id,name,whatsapp_link_code,whatsapp_link_expires").eq("whatsapp_phone", from).maybeSingle();

  // ---------- vínculo do número ----------
  const code = text.match(/\b(\d{6})\b/)?.[1];
  if (!prof) {
    if (code) {
      const { data: owner } = await db.from("profiles").select("id,name")
        .eq("whatsapp_link_code", code).gt("whatsapp_link_expires", new Date().toISOString()).maybeSingle();
      if (owner) {
        await db.from("profiles").update({ whatsapp_phone: from, whatsapp_link_code: null, whatsapp_link_expires: null }).eq("id", owner.id);
        return reply(`✅ Pronto, ${owner.name ?? ""}! Seu WhatsApp está conectado.\n\n${HELP}`);
      }
      return reply("Código inválido ou expirado. Gere um novo no app em *Conexões → WhatsApp*.");
    }
    return reply("Olá! Para usar o assistente, abra o app, vá em *Conexões → WhatsApp* e me envie o código de 6 dígitos que aparecer lá.");
  }

  // ---------- comprovante (print ou PDF) ----------
  if (msg.type === "image" || (msg.type === "document" && /pdf|image/i.test(msg.document?.mime_type ?? ""))) {
    if (!Deno.env.get("ANTHROPIC_API_KEY")) {
      return reply("Para eu ler comprovantes, a IA precisa estar ativada (ANTHROPIC_API_KEY). Por enquanto, lance digitando: *paguei 50 pix maria*");
    }
    const media = msg.image ?? msg.document;
    const caption: string = (media?.caption ?? "").trim();
    try {
      const file = await downloadWhatsAppMedia(media.id);
      const r = await readReceipt(file.bytes, file.mime, prof.name);
      if (!r || !r.is_receipt || !r.amount) {
        return reply("Não encontrei um comprovante nessa imagem. Mande o print do comprovante (Pix, transferência, boleto ou nota) com o valor aparecendo.");
      }
      const empresa = /\b(empresa|reembolso|reembolsavel|reembolsável|trabalho)\b/i.test(caption);
      const out = await registerReceipt(db, prof.id, r, { reimbursable: empresa, caption });
      const dia = new Date(out.day + "T12:00:00Z").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "UTC" });
      const tipo = r.type === "income" ? "💵 Entrada" : r.type === "transfer" ? "↔️ Transferência entre suas contas" : "✅ Gasto";
      await reply(out.created
        ? `${tipo} registrado pelo comprovante: ${r.counterpart ?? r.description ?? ""} — ${brl(r.amount)} (${dia})${empresa ? "\n🏢 Marcado como reembolso da empresa" : ""}\n_Errou? Responda *desfazer* ou ajuste no app._`
        : `Esse ${brl(r.amount)} (${dia}) já estava registrado ✅ — não dupliquei.${empresa ? "\n🏢 Marquei como reembolso da empresa." : ""}`);
      if (out.created && r.type === "expense") await checkBudgetAlerts(db, prof.id);
    } catch (e) {
      console.error("receipt", e);
      await reply("Não consegui ler esse arquivo agora. Tente mandar de novo como *foto* (print da tela) ou lance digitando: *paguei 50 pix maria*");
    }
    return;
  }

  if (msg.type !== "text" && !text) return reply("Eu entendo mensagens de texto e comprovantes (foto ou PDF). Digite *ajuda* para ver os comandos.");
  const t = norm(text);
  const uid = prof.id;

  if (/^\d{6}$/.test(t)) return reply("Seu WhatsApp já está conectado ✅. Digite *ajuda* para ver os comandos.");
  if (/^(oi|ola|ajuda|menu|help|comandos|\?)$/.test(t)) return reply(HELP);
  if (/^(resumo|saldo|status|quanto (eu )?posso gastar\??)$/.test(t)) return reply(await summaryText(db, uid));
  if (/^(hoje|gastos de hoje)$/.test(t)) return reply(await periodText(db, uid, "hoje"));
  if (/^(semana|gastos da semana)$/.test(t)) return reply(await periodText(db, uid, "semana"));
  if (/^(mes|gastos do mes)$/.test(t)) return reply(await periodText(db, uid, "mes"));
  if (/^(orcamento|categorias|metas)$/.test(t)) return reply(await budgetText(db, uid));
  if (/^(ultimos|extrato|lancamentos)$/.test(t)) return reply(await lastText(db, uid));
  if (/^(recorrentes|assinaturas|fixos)$/.test(t)) return reply(await recurringText(db, uid));
  if (/^(reembolso|reembolsos|empresa)$/.test(t)) return reply(await reimbursableText(db, uid));
  if (/^(fatura|faturas|parcelas|compromissos|cartao|cartoes|contas|vencimentos)$/.test(t)) return reply(await commitmentsText(db, uid));
  if (/^(desfazer|apagar ultimo|cancelar)$/.test(t)) {
    const { data: last } = await db.from("transactions").select("id,description,amount")
      .eq("user_id", uid).eq("source", "whatsapp").is("deleted_at", null)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!last) return reply("Não há lançamento feito pelo WhatsApp para desfazer.");
    await db.from("transactions").update({ deleted_at: new Date().toISOString() }).eq("id", last.id);
    return reply(`🗑️ Removido: ${last.description} — ${brl(last.amount)}`);
  }

  // ---------- lançamento rápido ----------
  const isQuestion = /\?|^(quanto|qual|quais|como|onde|quando|posso|devo|me (mostra|diz|fala))/.test(t);
  const entry = !isQuestion ? parseChatEntry(text) : null;
  if (entry) {
    const empresa = /\b(empresa|reembolso|reembolsavel|trabalho)\b/.test(t);
    const r = await ingestBatch(db, uid, [{
      source: "whatsapp", type: entry.type, amount: entry.amount, merchant: entry.merchant,
      description: entry.description.replace(/\b(empresa|reembolso)\b/gi, "").trim() || entry.description,
      occurred_at: new Date().toISOString(), raw: { text },
    }]);
    const id = r.ids[0];
    if (empresa && id) await db.from("transactions").update({ reimbursable: true }).eq("id", id);
    const { data: tx } = await db.from("transactions").select("categories(name,icon,monthly_budget)").eq("id", id).single();
    const cat: any = (tx as any)?.categories;
    let extra = "";
    if (entry.type === "expense" && cat?.monthly_budget) {
      const { data: s } = await db.rpc("financial_snapshot_for", { p_user: uid });
      const c = (s?.categories ?? []).find((x: any) => x.name === cat.name);
      if (c) extra = `\n${cat.name}: ${brl(c.spent)} de ${brl(c.budget)} no ciclo`;
    }
    await reply(`${entry.type === "income" ? "💵 Entrada" : "✅ Gasto"} registrado: ${entry.description} — ${brl(entry.amount)}\nCategoria: ${cat ? `${cat.icon} ${cat.name}` : "sem categoria"}${empresa ? "\n🏢 Marcado como reembolso da empresa" : ""}${extra}\n_Errou? Responda *desfazer* ou ajuste no app._`);
    if (entry.type === "expense") await checkBudgetAlerts(db, uid);
    return;
  }

  // ---------- pergunta livre → IA ----------
  if (Deno.env.get("ANTHROPIC_API_KEY")) {
    const limit = Number(Deno.env.get("AI_DAILY_LIMIT") ?? 30);
    const { data: ok } = await db.rpc("ai_take", { p_user: uid, p_limit: limit });
    if (!ok) return reply(`Você chegou ao limite de ${limit} perguntas livres por hoje. Os comandos (*resumo*, *mês*, *fatura*…) continuam funcionando.`);
    return reply(await askAI(db, uid, text));
  }
  return reply(`Não entendi 🤔\n\n${HELP}`);
}

async function askAI(db: ReturnType<typeof admin>, uid: string, question: string) {
  const ctx = await aiContext(db, uid);
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": env("ANTHROPIC_API_KEY"),
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: Deno.env.get("ANTHROPIC_MODEL") ?? "claude-haiku-4-5-20251001",
      max_tokens: 700,
      system: `Você é um assistente financeiro pessoal no WhatsApp. Responda em português do Brasil, curto (até 8 linhas), usando *negrito* do WhatsApp. Use SOMENTE os dados fornecidos; faça as contas com cuidado; se faltar dado, diga. Não dê recomendação de investimento específica. Hoje é ${new Date().toISOString().slice(0, 10)}.
Resumo do ciclo atual (JSON): ${JSON.stringify(ctx.snapshot)}
Transações dos últimos 90 dias (data|tipo|valor|categoria|descrição):
${ctx.transactions_90d}`,
      messages: [{ role: "user", content: question.slice(0, 1000) }],
    }),
  });
  if (!res.ok) { console.error("anthropic", await res.text()); return "Não consegui responder agora. Tente *resumo* ou *mês*."; }
  const data = await res.json();
  return data.content?.find((c: any) => c.type === "text")?.text ?? "Sem resposta.";
}
