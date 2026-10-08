// Resumo semanal no WhatsApp (agendar segunda 9h via Supabase Cron — ver README).
// Protegido por CRON_SECRET no header Authorization: Bearer <CRON_SECRET>.
import { admin, env } from "../_shared/supabase.ts";
import { notifyUser } from "../_shared/notify.ts";
import { summaryText } from "../_shared/reports.ts";

Deno.serve(async (req) => {
  if (req.headers.get("authorization") !== `Bearer ${env("CRON_SECRET")}`) return new Response("forbidden", { status: 403 });
  const db = admin();
  const { data: users } = await db.from("profiles").select("id,name,whatsapp_phone,telegram_chat_id")
    .or("whatsapp_phone.not.is.null,telegram_chat_id.not.is.null").eq("alerts_enabled", true);
  let sent = 0;
  for (const u of users ?? []) {
    try {
      let text = `☀️ Bom dia${u.name ? `, ${u.name.split(" ")[0]}` : ""}! Seu resumo da semana:\n\n${await summaryText(db, u.id)}`;
      // Celular parou de mandar notificações? Avisa para não perder lançamentos.
      const { data: last } = await db.from("notification_inbox").select("received_at")
        .eq("user_id", u.id).order("received_at", { ascending: false }).limit(1).maybeSingle();
      if (last && Date.now() - Date.parse(last.received_at) > 3 * 86_400_000) {
        const d = new Date(last.received_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" });
        text += `\n\n📵 Seu celular não envia notificações de gasto desde ${d}. Confira se o MacroDroid está ligado.`;
      }
      if (await notifyUser(db, u.id, text)) sent++;
    } catch (e) { console.error("digest", u.id, e); }
  }
  return new Response(JSON.stringify({ sent }), { headers: { "Content-Type": "application/json" } });
});
