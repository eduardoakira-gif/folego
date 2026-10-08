-- =====================================================================
-- 005 — Assistente também no Telegram
-- =====================================================================
alter table public.profiles add column if not exists telegram_chat_id bigint unique;

-- nova origem de lançamento: mensagem no Telegram
alter table public.transactions drop constraint if exists transactions_source_check;
alter table public.transactions add constraint transactions_source_check
  check (source in ('open_finance','notification','manual','whatsapp','telegram','import'));

create or replace function public.telegram_unlink() returns void
language sql security definer set search_path = public as $$
  update profiles set telegram_chat_id = null where id = auth.uid();
$$;
revoke execute on function public.telegram_unlink() from public, anon;
grant  execute on function public.telegram_unlink() to authenticated;
