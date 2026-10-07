import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";

export const env = (k: string, required = true): string => {
  const v = Deno.env.get(k);
  if (!v && required) throw new Error(`Variável de ambiente ausente: ${k}`);
  return v ?? "";
};

/**
 * Chaves do projeto. Projetos novos do Supabase usam chaves sb_publishable_/sb_secret_
 * (em SUPABASE_PUBLISHABLE_KEYS / SUPABASE_SECRET_KEYS); os antigos, anon/service_role.
 * Aceitamos os dois formatos.
 */
function projectKey(newVar: string, legacyVar: string): string {
  const raw = Deno.env.get(newVar);
  if (raw) {
    try {
      const v = JSON.parse(raw);
      const first = typeof v === "string" ? v : Array.isArray(v) ? v[0] : (v.default ?? Object.values(v)[0]);
      if (first) return String(first);
    } catch { return raw; }
  }
  return env(legacyVar);
}
const serviceKey = () => projectKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
const publicKey = () => projectKey("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY");

/** Cliente administrativo — ignora RLS. Usar só no servidor e sempre filtrando por user_id. */
export const admin = (): SupabaseClient =>
  createClient(env("SUPABASE_URL"), serviceKey(), { auth: { persistSession: false } });

/** Valida o JWT do usuário logado no app e devolve o id. */
export async function requireUser(req: Request): Promise<string> {
  return (await requireUserInfo(req)).id;
}

export async function requireUserInfo(req: Request): Promise<{ id: string; email: string }> {
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) throw new HttpError(401, "Sessão inválida. Entre novamente.");
  const client = createClient(env("SUPABASE_URL"), publicKey(), {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  });
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new HttpError(401, "Sessão inválida. Entre novamente.");
  return { id: data.user.id, email: (data.user.email ?? "").toLowerCase() };
}

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const ALLOWED = (Deno.env.get("APP_ORIGINS") ?? "*").split(",").map((s) => s.trim());
export function cors(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "";
  const allow = ALLOWED.includes("*") ? "*" : ALLOWED.includes(origin) ? origin : ALLOWED[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-ingest-token",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Vary": "Origin",
  };
}

export function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(req), "Content-Type": "application/json" },
  });
}

/** Envolve o handler: CORS, erros padronizados, log. */
export function handler(fn: (req: Request) => Promise<Response>) {
  return async (req: Request) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
    try {
      return await fn(req);
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status >= 500) console.error(e);
      return json(req, { error: e instanceof Error ? e.message : String(e) }, status);
    }
  };
}

export const brl = (n: number) =>
  Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
