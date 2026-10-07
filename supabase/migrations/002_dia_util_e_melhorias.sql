-- =====================================================================
-- 002 — Dia do pagamento por dia útil + correções e melhorias
-- Roda depois do 001. Pode ser executado mais de uma vez.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. PERFIL: modo do dia de pagamento
--   fixed        → todo dia N do mês (se cair em fim de semana, conta o dia N mesmo)
--   business_day → N-ésimo dia útil do mês (ex: 5º dia útil)
-- ---------------------------------------------------------------------
alter table public.profiles add column if not exists payday_mode text not null default 'fixed';
alter table public.profiles add column if not exists payday_count_saturday boolean not null default false;
alter table public.profiles drop constraint if exists profiles_payday_mode_check;
alter table public.profiles add constraint profiles_payday_mode_check check (payday_mode in ('fixed','business_day'));
alter table public.profiles drop constraint if exists profiles_payday_business_check;
alter table public.profiles add constraint profiles_payday_business_check
  check (payday_mode = 'fixed' or payday between 1 and 23);
grant update (payday_mode, payday_count_saturday) on public.profiles to authenticated;

-- nova origem: extrato importado (OFX/CSV)
alter table public.transactions drop constraint if exists transactions_source_check;
alter table public.transactions add constraint transactions_source_check
  check (source in ('open_finance','notification','manual','whatsapp','import'));

-- ---------------------------------------------------------------------
-- 2. CALENDÁRIO: feriados nacionais e bancários
-- ---------------------------------------------------------------------
-- Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher)
create or replace function public.easter_date(y int) returns date
language plpgsql immutable as $$
declare a int; b int; c int; d int; e int; f int; g int; h int; i int; k int; l int; m int; mo int; dy int;
begin
  a := y % 19; b := y / 100; c := y % 100; d := b / 4; e := b % 4;
  f := (b + 8) / 25; g := (b - f + 1) / 3; h := (19*a + b - d - g + 15) % 30;
  i := c / 4; k := c % 4; l := (32 + 2*e + 2*i - h - k) % 7; m := (a + 11*h + 22*l) / 451;
  mo := (h + l - 7*m + 114) / 31; dy := ((h + l - 7*m + 114) % 31) + 1;
  return make_date(y, mo, dy);
end $$;

-- Dias sem expediente bancário no Brasil (nacionais + Carnaval + Corpus Christi)
create or replace function public.br_bank_holidays(y int) returns setof date
language sql immutable as $$
  select make_date(y, m, d) from (values (1,1),(4,21),(5,1),(9,7),(10,12),(11,2),(11,15),(11,20),(12,25)) v(m, d)
  union all select easter_date(y) - 48   -- segunda de Carnaval
  union all select easter_date(y) - 47   -- terça de Carnaval
  union all select easter_date(y) - 2    -- Sexta-feira Santa
  union all select easter_date(y) + 60   -- Corpus Christi
$$;

create or replace function public.is_business_day(d date, count_saturday boolean default false) returns boolean
language sql immutable as $$
  select extract(isodow from d) < 6 + (case when count_saturday then 1 else 0 end)
     and d not in (select br_bank_holidays(extract(year from d)::int))
$$;

-- N-ésimo dia útil do mês
create or replace function public.nth_business_day(y int, m int, n int, count_saturday boolean default false) returns date
language sql immutable as $$
  select d::date from generate_series(make_date(y, m, 1), make_date(y, m, 1) + interval '1 month - 1 day', interval '1 day') d
   where is_business_day(d::date, count_saturday)
   order by d offset greatest(n, 1) - 1 limit 1
$$;

-- Dia do pagamento em um mês, conforme a regra escolhida
create or replace function public.payday_in_month(p_mode text, p_n int, p_sat boolean, y int, m int) returns date
language sql immutable as $$
  select case when p_mode = 'business_day' then nth_business_day(y, m, p_n, p_sat)
              else make_date(y, m, least(p_n, extract(day from (make_date(y, m, 1) + interval '1 month - 1 day'))::int)) end
$$;

-- Ciclo (do pagamento até a véspera do próximo) que contém p_ref
create or replace function public.cycle_for_rule(p_mode text, p_n int, p_sat boolean, p_ref date)
returns table (cycle_start date, cycle_end date, next_payday date)
language plpgsql immutable as $$
declare
  this_m date := date_trunc('month', p_ref)::date;
  prev_m date := (date_trunc('month', p_ref) - interval '1 month')::date;
  next_m date := (date_trunc('month', p_ref) + interval '1 month')::date;
  p_this date; s date; nx date;
begin
  p_this := payday_in_month(p_mode, p_n, p_sat, extract(year from this_m)::int, extract(month from this_m)::int);
  if p_ref >= p_this then
    s  := p_this;
    nx := payday_in_month(p_mode, p_n, p_sat, extract(year from next_m)::int, extract(month from next_m)::int);
  else
    s  := payday_in_month(p_mode, p_n, p_sat, extract(year from prev_m)::int, extract(month from prev_m)::int);
    nx := p_this;
  end if;
  return query select s, nx - 1, nx;
end $$;

create or replace function public.user_cycle(p_user uuid, p_ref date)
returns table (cycle_start date, cycle_end date, next_payday date)
language sql stable security definer set search_path = public as $$
  select c.* from profiles p, cycle_for_rule(p.payday_mode, p.payday, p.payday_count_saturday, p_ref) c where p.id = p_user
$$;

-- Para o app: ciclo do usuário logado (navegar entre ciclos)
create or replace function public.my_cycle(p_ref date default null)
returns table (cycle_start date, cycle_end date, next_payday date)
language sql stable security definer set search_path = public as $$
  select * from user_cycle(auth.uid(), coalesce(p_ref, (now() at time zone 'America/Sao_Paulo')::date))
$$;

-- Prévia na tela de configuração: próximas datas de pagamento para uma regra
create or replace function public.preview_paydays(p_mode text, p_n int, p_sat boolean)
returns setof date language sql stable as $$
  select payday_in_month(p_mode, p_n, p_sat, extract(year from m)::int, extract(month from m)::int)
    from generate_series(date_trunc('month', now() at time zone 'America/Sao_Paulo'),
                         date_trunc('month', now() at time zone 'America/Sao_Paulo') + interval '3 months', interval '1 month') m
   where payday_in_month(p_mode, p_n, p_sat, extract(year from m)::int, extract(month from m)::int) >= (now() at time zone 'America/Sao_Paulo')::date
   limit 3
$$;

-- Onboarding com o modo de pagamento
create or replace function public.complete_onboarding(p_name text, p_income numeric, p_payday int, p_payday_mode text, p_count_saturday boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  perform seed_user(auth.uid());
  update profiles set name = p_name, monthly_income = p_income, payday = p_payday,
         payday_mode = coalesce(p_payday_mode, 'fixed'), payday_count_saturday = coalesce(p_count_saturday, false), onboarded = true
   where id = auth.uid();
  update categories set monthly_budget = round(p_income * budget_pct / 100, 2)
   where user_id = auth.uid() and budget_pct is not null;
end $$;

-- ---------------------------------------------------------------------
-- 3. DATA LOCAL — o banco trabalha em UTC; uma compra às 22h em São Paulo
--    é 01h do dia seguinte em UTC. Toda conta por dia usa o horário de Brasília.
-- ---------------------------------------------------------------------
create or replace function public.local_date(ts timestamptz) returns date
language sql immutable as $$ select (ts at time zone 'America/Sao_Paulo')::date $$;

create index if not exists tx_user_localdate on public.transactions (user_id, local_date(occurred_at)) where deleted_at is null;

create or replace function public.recurring_for(p_user uuid)
returns table (merchant text, avg_amount numeric, months int, last_date date, next_expected date, category_id uuid)
language sql stable security definer set search_path = public as $$
  with t as (
    select lower(regexp_replace(coalesce(merchant, description), '[^a-zA-Z ]', '', 'g')) as key,
           coalesce(merchant, description) as label, amount, local_date(occurred_at) d, category_id
      from transactions
     where user_id = p_user and type = 'expense' and deleted_at is null and installment is null
       and occurred_at >= now() - interval '120 days'
  ), g as (
    select key, max(label) label, avg(amount) avg_amount, count(distinct date_trunc('month', d)) months,
           max(d) last_date, (array_agg(category_id order by d desc))[1] category_id,
           (max(amount) - min(amount)) / nullif(avg(amount),0) spread
      from t where length(key) >= 3 group by key
  )
  select label, round(avg_amount, 2), months::int, last_date, (last_date + interval '1 month')::date, category_id
    from g where months >= 2 and spread <= 0.3
   order by avg_amount desc
$$;

-- ---------------------------------------------------------------------
-- 4. TRANSFERÊNCIA ENTRE BANCOS PRÓPRIOS
--    Pix do Nubank para o Itaú aparece como saída num banco e entrada no outro.
--    Sem isso, o mesmo dinheiro contaria como gasto E como renda.
-- ---------------------------------------------------------------------
create or replace function public.detect_internal_transfers(p_user uuid) returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0; k int; r record;
begin
  for r in
    select distinct on (e.id) e.id as eid, i.id as iid
      from transactions e
      join transactions i
        on i.user_id = e.user_id and i.type = 'income' and i.amount = e.amount
       and i.account_id is not null and e.account_id is not null and i.account_id <> e.account_id
       and abs(extract(epoch from i.occurred_at - e.occurred_at)) <= 129600   -- 1,5 dia
       and i.deleted_at is null and not i.category_locked
     where e.user_id = p_user and e.type = 'expense' and e.deleted_at is null and not e.category_locked
       and e.occurred_at > now() - interval '120 days'
       and (e.description || ' ' || coalesce(e.merchant, '')) ~* '(pix|ted|doc|transf)'
       and (i.description || ' ' || coalesce(i.merchant, '')) ~* '(pix|ted|doc|transf)'
     order by e.id, abs(extract(epoch from i.occurred_at - e.occurred_at))
  loop
    update transactions set type = 'transfer', category_id = null, note = coalesce(note, 'Transferência entre suas contas (detectada automaticamente)')
     where id in (r.eid, r.iid) and type <> 'transfer';
    get diagnostics k = row_count;
    n := n + k;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------------
-- 5. RESUMO FINANCEIRO (substitui o do 001)
--   • ciclo pela regra do usuário (dia fixo ou dia útil)
--   • datas no horário de Brasília
--   • salário que cai até 3 dias antes do ciclo conta para o ciclo novo
--   • faturas de cartão e parcelas que ainda vão vencer
-- ---------------------------------------------------------------------
create or replace function public.financial_snapshot_for(p_user uuid, p_ref date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  pr profiles; cs date; ce date; np date; today date;
  sal uuid[]; inc numeric; exp numeric; days_left int; committed numeric; result jsonb;
begin
  today := coalesce(p_ref, local_date(now()));
  select * into pr from profiles where id = p_user;
  if pr.id is null then return null; end if;
  select c.cycle_start, c.cycle_end, c.next_payday into cs, ce, np from user_cycle(p_user, today) c;
  select array_agg(id) into sal from categories where user_id = p_user and kind = 'income' and name = 'Salário';

  select coalesce(sum(amount) filter (where type = 'income' and (
             (category_id = any(coalesce(sal, '{}')) and local_date(occurred_at) between cs - 3 and ce - 3)
          or (not coalesce(category_id = any(sal), false) and local_date(occurred_at) between cs and ce))), 0),
         coalesce(sum(amount) filter (where type = 'expense' and local_date(occurred_at) between cs and ce), 0)
    into inc, exp
    from transactions
   where user_id = p_user and deleted_at is null and local_date(occurred_at) between cs - 3 and ce;

  inc := greatest(inc, pr.monthly_income);
  days_left := greatest(ce - today + 1, 1);

  select coalesce(sum(avg_amount), 0) into committed
    from recurring_for(p_user) r
   where r.next_expected between today and ce and r.last_date < cs;

  select jsonb_build_object(
    'cycle_start', cs, 'cycle_end', ce, 'next_payday', np, 'days_left', days_left,
    'payday_mode', pr.payday_mode, 'payday', pr.payday,
    'income', inc, 'expenses', exp,
    'committed_recurring', committed,
    'available', round(inc - exp - committed, 2),
    'per_day', round(greatest(inc - exp - committed, 0) / days_left, 2),
    'pending_review', (select count(*) from transactions where user_id = p_user and deleted_at is null
                         and ((category_id is null and type <> 'transfer') or status = 'pending')),
    'reimbursable_open', (select coalesce(sum(amount),0) from transactions where user_id = p_user
                            and deleted_at is null and reimbursable and reimbursed_at is null),
    'categories', coalesce((
      select jsonb_agg(c order by (c->>'spent')::numeric desc) from (
        select jsonb_build_object(
          'id', cat.id, 'name', cat.name, 'icon', cat.icon, 'color', cat.color, 'kind', cat.kind,
          'budget', cat.monthly_budget,
          'spent', coalesce(sum(t.amount), 0),
          'pct', case when cat.monthly_budget > 0 then round(coalesce(sum(t.amount),0) / cat.monthly_budget * 100) end
        ) c
          from categories cat
          left join transactions t on t.category_id = cat.id and t.deleted_at is null and t.type <> 'transfer'
                                  and local_date(t.occurred_at) between cs and ce
         where cat.user_id = p_user and not cat.archived
         group by cat.id
      ) q where (q.c->>'spent')::numeric > 0 or (q.c->>'budget') is not null), '[]'::jsonb),
    'recurring', coalesce((select jsonb_agg(to_jsonb(r)) from recurring_for(p_user) r), '[]'::jsonb),
    -- faturas abertas dos cartões conectados
    'card_bills', coalesce((
      select jsonb_agg(jsonb_build_object('account', a.name, 'institution', bc.institution, 'amount', a.balance, 'due', a.bill_due_date) order by a.bill_due_date)
        from accounts a left join bank_connections bc on bc.id = a.connection_id
       where a.user_id = p_user and a.type = 'CREDIT' and a.balance > 0
         and a.bill_due_date is not null and a.bill_due_date >= today), '[]'::jsonb),
    -- parcelas que ainda vão cair (compras parceladas no cartão)
    'installments', (
      with last as (
        select distinct on (lower(coalesce(merchant, description)), amount, split_part(installment, '/', 2))
               coalesce(merchant, description) label, amount,
               split_part(installment, '/', 1)::int n, split_part(installment, '/', 2)::int total
          from transactions
         where user_id = p_user and deleted_at is null and type = 'expense'
           and installment ~ '^\d+/\d+$' and occurred_at > now() - interval '45 days'
         order by lower(coalesce(merchant, description)), amount, split_part(installment, '/', 2), split_part(installment, '/', 1)::int desc
      )
      select jsonb_build_object(
        'next_3_months', coalesce(sum(amount * least(total - n, 3)), 0),
        'total_remaining', coalesce(sum(amount * (total - n)), 0),
        'items', coalesce(jsonb_agg(jsonb_build_object('label', label, 'amount', amount, 'remaining', total - n) order by amount * (total - n) desc) filter (where total > n), '[]'::jsonb))
        from last where total > n)
  ) into result;
  return result;
end $$;

drop function if exists public.financial_snapshot(date);
create or replace function public.financial_snapshot(p_ref date default null)
returns jsonb language sql stable security definer set search_path = public as $$
  select financial_snapshot_for(auth.uid(), p_ref)
$$;

-- ---------------------------------------------------------------------
-- 6. EVENTOS — base para outros módulos do Life OS reagirem ao financeiro
--    (metas, agenda, tarefas) sem depender diretamente destas tabelas.
-- ---------------------------------------------------------------------
create table if not exists public.events (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  type       text not null,                 -- transaction.created | transaction.updated | transaction.deleted
  entity_id  uuid,
  payload    jsonb,
  at         timestamptz not null default now()
);
create index if not exists events_user_at on public.events (user_id, at desc);
alter table public.events enable row level security;
drop policy if exists own_rows_read on public.events;
create policy own_rows_read on public.events for select using (user_id = auth.uid());

create or replace function public.emit_transaction_event() returns trigger
language plpgsql security definer set search_path = public as $$
declare kind text;
begin
  if tg_op = 'INSERT' then kind := 'transaction.created';
  elsif new.deleted_at is not null and old.deleted_at is null then kind := 'transaction.deleted';
  elsif (to_jsonb(old) - 'updated_at' - 'raw') is distinct from (to_jsonb(new) - 'updated_at' - 'raw') then kind := 'transaction.updated';
  else return new;
  end if;
  insert into events(user_id, type, entity_id, payload)
  values (new.user_id, kind, new.id, jsonb_build_object(
    'type', new.type, 'amount', new.amount, 'category_id', new.category_id,
    'description', new.description, 'occurred_at', new.occurred_at, 'source', new.source));
  return new;
end $$;
drop trigger if exists trg_tx_events on public.transactions;
create trigger trg_tx_events after insert or update on public.transactions for each row execute function public.emit_transaction_event();

-- ---------------------------------------------------------------------
-- 7. LIMITE DIÁRIO DE PERGUNTAS À IA (controle de custo por usuário)
-- ---------------------------------------------------------------------
create table if not exists public.ai_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  day     date not null,
  count   int not null default 0,
  primary key (user_id, day)
);
alter table public.ai_usage enable row level security;

create or replace function public.ai_take(p_user uuid, p_limit int) returns boolean
language plpgsql security definer set search_path = public as $$
declare c int;
begin
  insert into ai_usage(user_id, day, count) values (p_user, local_date(now()), 1)
  on conflict (user_id, day) do update set count = ai_usage.count + 1
  returning count into c;
  return c <= p_limit;
end $$;

-- Exclusão de conta também apaga eventos
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = public, auth as $$
begin
  delete from audit_log where user_id = auth.uid();
  delete from auth.users where id = auth.uid();
end $$;

-- ---------------------------------------------------------------------
-- 8. PERMISSÕES
-- ---------------------------------------------------------------------
revoke execute on function public.financial_snapshot_for(uuid, date) from public, anon, authenticated;
revoke execute on function public.user_cycle(uuid, date)             from public, anon, authenticated;
revoke execute on function public.detect_internal_transfers(uuid)    from public, anon, authenticated;
revoke execute on function public.ai_take(uuid, int)                 from public, anon, authenticated;
revoke execute on function public.recurring_for(uuid)                from public, anon, authenticated;
grant  execute on function public.financial_snapshot_for(uuid, date) to service_role;
grant  execute on function public.user_cycle(uuid, date)             to service_role;
grant  execute on function public.detect_internal_transfers(uuid)    to service_role;
grant  execute on function public.ai_take(uuid, int)                 to service_role;
grant  execute on function public.recurring_for(uuid)                to service_role;
grant  execute on function public.financial_snapshot(date)           to authenticated;
grant  execute on function public.my_cycle(date)                     to authenticated;
grant  execute on function public.preview_paydays(text, int, boolean) to authenticated;
grant  execute on function public.complete_onboarding(text, numeric, int, text, boolean) to authenticated;
