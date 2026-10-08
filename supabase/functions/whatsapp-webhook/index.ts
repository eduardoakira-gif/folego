// Bot do WhatsApp (Cloud API oficial).
//  GET  → verificação do webhook pela Meta
//  POST → mensagens recebidas (assinatura X-Hub-Signature-256 validada)
import { admin, env } from "../_shared/supabase.ts";
import { sendWhatsApp, verifyMetaSignature } from "../_shared/whatsapp.ts";
import { downloadWhatsAppMedia } from "../_shared/receipt.ts";
import { handleBotMessage, HELP } from "../_shared/bot.ts";
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

  const isMedia = msg.type === "image" || (msg.type === "document" && /pdf|image/i.test(msg.document?.mime_type ?? ""));
  const media = msg.image ?? msg.document;
  return handleBotMessage(db, prof, {
    channel: "whatsapp",
    text,
    caption: media?.caption,
    media: isMedia ? () => downloadWhatsAppMedia(media.id) : undefined,
    reply,
  });
}
