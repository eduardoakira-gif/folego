// Resumo semanal no WhatsApp (agendar segunda 9h via Supabase Cron — ver README).
// Protegido por CRON_SECRET no header Authorization: Bearer <CRON_SECRET>.
import { admin, env } from "../_shared/supabase.ts";
import { sendWhatsApp } from "../_shared/whatsapp.ts";
import { summaryText } from "../_shared/reports.ts";

Deno.serve(async (req) => {
  if (req.headers.get("authorization") !== `Bearer ${env("CRON_SECRET")}`) return new Response("forbidden", { status: 403 });
  const db = admin();
  const { data: users } = await db.from("profiles").select("id,name,whatsapp_phone")
    .not("whatsapp_phone", "is", null).eq("alerts_enabled", true);
  let sent = 0;
  for (const u of users ?? []) {
    try {
      const text = `☀️ Bom dia${u.name ? `, ${u.name.split(" ")[0]}` : ""}! Seu resumo da semana:\n\n${await summaryText(db, u.id)}`;
      if (await sendWhatsApp(u.whatsapp_phone!, text)) sent++;
    } catch (e) { console.error("digest", u.id, e); }
  }
  return new Response(JSON.stringify({ sent }), { headers: { "Content-Type": "application/json" } });
});
