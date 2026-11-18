-- Only the server can read integration tokens and imported private tasks.
create table public.ticktick_oauth_states (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  state_hash text unique not null,
  expires_at timestamptz not null,
  claimed boolean not null default false
);
create table public.ticktick_connections (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  token_ciphertext text not null,
  generation uuid not null default gen_random_uuid(),
  projects text[] not null default '{}',
  tasks jsonb not null default '[]',
  synced_at timestamptz,
  next_sync_at timestamptz not null default now(),
  sync_error text not null default '',
  lease_id uuid,
  lease_until timestamptz
);
create index ticktick_due on public.ticktick_connections(next_sync_at)
  where cardinality(projects) > 0 and sync_error <> 'reconnect';

alter table public.ticktick_oauth_states enable row level security;
alter table public.ticktick_connections enable row level security;
revoke all on public.ticktick_oauth_states, public.ticktick_connections from public, anon, authenticated;
grant select, insert, update, delete on public.ticktick_oauth_states, public.ticktick_connections to service_role;

create function public.ticktick_finish_link(p_state_hash text, p_ciphertext text)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare linked_user uuid;
begin
  delete from public.ticktick_oauth_states
    where state_hash = p_state_hash and claimed and expires_at > now()
    returning user_id into linked_user;
  if linked_user is null or not exists (
    select 1 from public.profiles where id = linked_user and data->>'role' in ('head', 'staff', 'coordinator')
    and coalesce((data->>'active')::boolean, true) and not coalesce((data->>'pending')::boolean, false)
  ) then return false; end if;
  insert into public.ticktick_connections(user_id, token_ciphertext) values (linked_user, p_ciphertext)
    on conflict (user_id) do update set token_ciphertext = excluded.token_ciphertext, generation = gen_random_uuid(),
      projects = '{}', tasks = '[]', synced_at = null, next_sync_at = now(), sync_error = '',
      lease_id = null, lease_until = null;
  return true;
end $$;

create function public.ticktick_disconnect(p_user uuid)
returns text language plpgsql security invoker set search_path = '' as $$
declare removed text;
begin
  delete from public.ticktick_oauth_states where user_id = p_user;
  delete from public.ticktick_connections where user_id = p_user returning token_ciphertext into removed;
  return removed;
end $$;

create function public.ticktick_claim_sync(p_user uuid default null)
returns setof public.ticktick_connections language sql security invoker set search_path = '' as $$
  with due as (
    select c.user_id from public.ticktick_connections c join public.profiles p on p.id = c.user_id
    where cardinality(c.projects) > 0 and c.sync_error <> 'reconnect'
      and (c.lease_until is null or c.lease_until <= now())
      and (c.next_sync_at <= now() or (p_user = c.user_id and c.synced_at is not null
        and c.synced_at <= now() - interval '1 minute' and c.sync_error = ''))
      and (p_user is null or c.user_id = p_user)
      and p.data->>'role' in ('head', 'staff', 'coordinator')
      and coalesce((p.data->>'active')::boolean, true) and not coalesce((p.data->>'pending')::boolean, false)
    order by c.next_sync_at
    limit 4 for update of c skip locked
  )
  update public.ticktick_connections c set lease_id = gen_random_uuid(), lease_until = now() + interval '2 minutes'
    from due where c.user_id = due.user_id returning c.*
$$;

revoke all on function public.ticktick_finish_link(text, text), public.ticktick_disconnect(uuid),
  public.ticktick_claim_sync(uuid) from public, anon, authenticated;
grant execute on function public.ticktick_finish_link(text, text), public.ticktick_disconnect(uuid),
  public.ticktick_claim_sync(uuid) to service_role;

create schema if not exists app_private;
create function app_private.dispatch_ticktick() returns void language plpgsql security definer set search_path = '' as $$
declare base text; hook text;
begin
  delete from public.ticktick_oauth_states where expires_at < now();
  if not exists (select 1 from public.ticktick_connections
    where cardinality(projects) > 0 and sync_error <> 'reconnect' and next_sync_at <= now()
      and (lease_until is null or lease_until <= now())) then return; end if;
  select value into base from public.app_secrets where key = 'functions_url';
  select value into hook from public.app_secrets where key = 'hook_secret';
  if base is null or hook is null then return; end if;
  perform net.http_post(url := base || '/ticktick', body := '{"action":"dispatch"}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-hook-secret', hook), timeout_milliseconds := 45000);
end $$;
revoke all on function app_private.dispatch_ticktick() from public, anon, authenticated;
select cron.schedule('ticktick-task-sync', '*/5 * * * *', 'select app_private.dispatch_ticktick()');
