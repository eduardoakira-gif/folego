-- =====================================================================
-- 004 — Contas a pagar, comparação com o ciclo anterior e correções
-- Só adiciona coisas; não apaga dados. Pode rodar mais de uma vez.
-- =====================================================================

-- Texto sem acento e em minúsculas, para comparar nomes
create or replace function public.norm_txt(x text) returns text
language sql immutable as $$
  select translate(lower(coalesce(x, '')), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc')
$$;

-- ---------------------------------------------------------------------
-- 1. CONTAS A PAGAR (aluguel dia 10, internet dia 15, escola dia 5…)
-- ---------------------------------------------------------------------
create table if not exists public.bills (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  amount      numeric(12,2) check (amount is null or amount > 0),   -- aproximado; vazio = valor varia
  due_day     smallint not null check (due_day between 1 and 31),
  category_id uuid references public.categories(id) on delete set null,
  match_text  text,                                                  -- como aparece no extrato (padrão: o nome)
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
alter table public.bills enable row level security;
drop policy if exists own_rows on public.bills;
create policy own_rows on public.bills for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Ocorrências das contas entre duas datas, já dizendo se foram pagas.
-- "Paga" = existe saída cujo nome contém o texto da conta, perto do vencimento
-- (15 dias antes até 10 depois) e, se a conta tem valor, com até 15% de diferença.
create or replace function public.bills_due_for(p_user uuid, p_from date, p_to date)
returns table (bill_id uuid, name text, amount numeric, due_date date, paid boolean,
               paid_amount numeric, paid_on date, category_id uuid)
language sql stable security definer set search_path = public as $$
  with months as (
    select generate_series(date_trunc('month', p_from - 31), date_trunc('month', p_to), interval '1 month')::date as m
  ), occ as (
    select b.id, b.name, b.amount, b.category_id, coalesce(nullif(trim(b.match_text), ''), b.name) as match,
           make_date(extract(year from m)::int, extract(month from m)::int,
                     least(b.due_day, extract(day from (m + interval '1 month - 1 day'))::int)) as due
      from bills b cross join months
     where b.user_id = p_user and b.active
  )
  select o.id, o.name, o.amount, o.due, p.id is not null, p.amount, local_date(p.occurred_at), o.category_id
    from occ o
    left join lateral (
      select t.id, t.amount, t.occurred_at
        from transactions t
       where t.user_id = p_user and t.deleted_at is null and t.type = 'expense'
         and local_date(t.occurred_at) between o.due - 15 and o.due + 10
         and norm_txt(coalesce(t.merchant, '') || ' ' || t.description) like '%' || norm_txt(o.match) || '%'
         and (o.amount is null or t.amount between o.amount * 0.85 and o.amount * 1.15)
       order by abs(local_date(t.occurred_at) - o.due)
       limit 1
    ) p on true
   where o.due between p_from and p_to
   order by o.due
$$;

-- ---------------------------------------------------------------------
-- 2. RESUMO: acrescenta contas a pagar e comparação ao resumo do 002
--    (o cálculo original passa a se chamar financial_snapshot_base)
-- ---------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'financial_snapshot_base') then
    alter function public.financial_snapshot_for(uuid, date) rename to financial_snapshot_base;
  end if;
end $$;

create or replace function public.financial_snapshot_for(p_user uuid, p_ref date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  base jsonb; today date; cs date; ce date; pcs date; pce date; elapsed int;
  bills_json jsonb; bills_commit numeric; rec_overlap numeric; committed numeric;
  inc numeric; exp numeric; days_left int;
  spent_now numeric; spent_prev numeric; prev_by_cat jsonb; has_prev boolean;
begin
  base := financial_snapshot_base(p_user, p_ref);
  if base is null then return null; end if;
  today := coalesce(p_ref, local_date(now()));
  cs := (base->>'cycle_start')::date;
  ce := (base->>'cycle_end')::date;

  -- contas do ciclo e quanto ainda falta pagar até o fim dele
  select coalesce(jsonb_agg(to_jsonb(b) order by b.due_date), '[]'::jsonb) into bills_json
    from bills_due_for(p_user, cs, ce) b;
  select coalesce(sum(b.amount), 0) into bills_commit
    from bills_due_for(p_user, today, ce) b where not b.paid;

  -- gasto recorrente que já é uma conta cadastrada não pode contar duas vezes
  select coalesce(sum(r.avg_amount), 0) into rec_overlap
    from recurring_for(p_user) r
   where r.next_expected between today and ce and r.last_date < cs
     and exists (select 1 from bills bl where bl.user_id = p_user and bl.active
                  and norm_txt(r.merchant) like '%' || norm_txt(coalesce(nullif(trim(bl.match_text), ''), bl.name)) || '%');

  committed := (base->>'committed_recurring')::numeric - rec_overlap + bills_commit;
  inc := (base->>'income')::numeric;
  exp := (base->>'expenses')::numeric;
  days_left := (base->>'days_left')::int;

  -- mesmo ponto do ciclo anterior (ex.: 10º dia contra 10º dia)
  select c.cycle_start, c.cycle_end into pcs, pce from user_cycle(p_user, cs - 1) c;
  elapsed := greatest(today - cs, 0);
  select coalesce(sum(amount), 0) into spent_now
    from transactions where user_id = p_user and deleted_at is null and type = 'expense'
     and local_date(occurred_at) between cs and today;
  select coalesce(sum(s), 0), coalesce(jsonb_object_agg(cid::text, s) filter (where cid is not null), '{}'::jsonb)
    into spent_prev, prev_by_cat
    from (select category_id as cid, sum(amount) as s from transactions
           where user_id = p_user and deleted_at is null and type = 'expense'
             and local_date(occurred_at) between pcs and least(pcs + elapsed, pce)
           group by category_id) x;
  -- só compara se havia lançamentos no ciclo anterior inteiro (evita comparação falsa no 1º mês)
  select exists (select 1 from transactions where user_id = p_user and deleted_at is null
                  and local_date(occurred_at) between pcs and pcs + 3) into has_prev;

  return base || jsonb_build_object(
    'bills', bills_json,
    'committed_bills', bills_commit,
    'committed_recurring', round(committed, 2),
    'available', round(inc - exp - committed, 2),
    'per_day', round(greatest(inc - exp - committed, 0) / greatest(days_left, 1), 2),
    'compare', case when has_prev then jsonb_build_object(
      'elapsed_days', elapsed + 1, 'spent_now', spent_now, 'spent_prev', spent_prev,
      'prev_by_category', prev_by_cat) end
  );
end $$;

-- ---------------------------------------------------------------------
-- 3. CORREÇÕES DE DADOS
--    Mercado Livre caía em "Mercado" (supermercado). Corrige o que não foi
--    escolhido à mão e deixa o nome legível.
-- ---------------------------------------------------------------------
update public.transactions set merchant = 'Mercado Livre'
 where deleted_at is null and coalesce(merchant, description) ~* '^\s*(mercado ?livre|mercadolivre|mercadolibre)';

update public.transactions t set category_id = c2.id
  from public.categories c1, public.categories c2
 where t.category_id = c1.id and c1.name = 'Mercado' and c1.kind = 'expense'
   and c2.user_id = t.user_id and c2.name = 'Compras' and c2.kind = 'expense'
   and not t.category_locked and t.deleted_at is null
   and norm_txt(coalesce(t.merchant, '') || ' ' || t.description) ~ '(mercado ?livre|mercadolivre|mercadolibre)';

-- ---------------------------------------------------------------------
-- 4. PERMISSÕES
-- ---------------------------------------------------------------------
revoke execute on function public.financial_snapshot_base(uuid, date) from public, anon, authenticated;
revoke execute on function public.financial_snapshot_for(uuid, date)  from public, anon, authenticated;
revoke execute on function public.bills_due_for(uuid, date, date)     from public, anon, authenticated;
grant  execute on function public.financial_snapshot_base(uuid, date) to service_role;
grant  execute on function public.financial_snapshot_for(uuid, date)  to service_role;
grant  execute on function public.bills_due_for(uuid, date, date)     to service_role;
