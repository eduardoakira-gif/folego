// Envia um aviso ao usuário pelo canal que ele conectou (Telegram e/ou WhatsApp).
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { sendWhatsApp } from "./whatsapp.ts";
import { sendTelegram } from "./telegram.ts";

export async function notifyUser(db: SupabaseClient, userId: string, text: string): Promise<boolean> {
  const { data: p } = await db.from("profiles").select("whatsapp_phone,telegram_chat_id,alerts_enabled").eq("id", userId).maybeSingle();
  if (!p || !p.alerts_enabled) return false;
  let sent = false;
  if (p.telegram_chat_id && Deno.env.get("TELEGRAM_BOT_TOKEN")) sent = (await sendTelegram(p.telegram_chat_id, text)) || sent;
  if (p.whatsapp_phone && Deno.env.get("WA_ACCESS_TOKEN")) sent = (await sendWhatsApp(p.whatsapp_phone, text)) || sent;
  return sent;
}
