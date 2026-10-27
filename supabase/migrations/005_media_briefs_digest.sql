-- Шаблоны медиа-штаба «что публикуем сегодня», план постов ПД, сводки и напоминания по расписанию.

create or replace function my_title() returns text language sql stable security definer set search_path = public as
$$ select data->>'title' from profiles where id = auth.uid() and coalesce((data->>'active')::boolean, true) $$;
revoke execute on function public.my_title() from public, anon;
grant execute on function public.my_title() to authenticated;

create table media_briefs (id text primary key, data jsonb not null, created_at timestamptz not null default now());
create index on media_briefs (created_at desc);
alter table media_briefs enable row level security;
create policy mb_read on media_briefs for select to authenticated using (my_role() is not null);
create policy mb_insert on media_briefs for insert to authenticated with check (is_head() or my_title() = 'media');
create policy mb_update on media_briefs for update to authenticated using (is_head() or my_title() = 'media') with check (is_head() or my_title() = 'media');

create or replace function media_briefs_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  if length(trim(coalesce(new.data->>'title', ''))) < 3 then raise exception 'Укажите тему публикации'; end if;
  if length(trim(coalesce(new.data->>'text', ''))) < 10 then raise exception 'Добавьте текст шаблона'; end if;
  if tg_op = 'INSERT' then
    new.data := new.data || jsonb_build_object('id', new.id, 'authorId', auth.uid()::text, 'createdAt', now(), 'day', msk_today());
  else
    new.data := new.data || jsonb_build_object('id', old.id, 'authorId', old.data->>'authorId', 'createdAt', old.data->>'createdAt', 'day', old.data->>'day');
  end if;
  return new;
end $$;
revoke execute on function public.media_briefs_guard() from public, anon, authenticated;
create trigger media_briefs_guard before insert or update on media_briefs for each row execute function media_briefs_guard();
create trigger audit after insert or update on media_briefs for each row execute function write_audit();

-- Новый шаблон сразу уходит всей команде: колокольчик + Telegram (через триггер notify_telegram)
create or replace function media_briefs_notify() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into notifications (id, user_id, data)
  select 'br_' || new.id || '_' || left(p.id::text, 8), p.id,
         jsonb_build_object('id', 'br_' || new.id || '_' || left(p.id::text, 8), 'userId', p.id::text,
           'text', 'Медиа-штаб: что публикуем — «' || (new.data->>'title') || '»' || E'\n\n' || left(new.data->>'text', 900),
           'at', now(), 'read', false, 'link', '#/media/brief', 'kind', 'media')
  from profiles p
  where p.id::text <> new.data->>'authorId' and coalesce((p.data->>'active')::boolean, true) and not coalesce((p.data->>'pending')::boolean, false)
  on conflict (id) do nothing;
  return new;
end $$;
revoke execute on function public.media_briefs_notify() from public, anon, authenticated;
create trigger media_briefs_notify after insert on media_briefs for each row execute function media_briefs_notify();
alter publication supabase_realtime add table media_briefs;

-- Вызов функции digest по расписанию (секрет — как у Telegram-хука)
create or replace function call_digest(action text) returns bigint language plpgsql security definer set search_path = public, extensions as $$
declare url text; secret text;
begin
  select value into url from app_secrets where key = 'functions_url';
  select value into secret from app_secrets where key = 'hook_secret';
  return net.http_post(url := url || '/digest', body := jsonb_build_object('action', action),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-hook-secret', secret), timeout_milliseconds := 60000);
end $$;
revoke execute on function public.call_digest(text) from public, anon, authenticated;
-- понедельник 10:00 МСК — сводка за неделю; будни 12:00 МСК — напоминание тем, кто давно не писал пост
select cron.schedule('weekly-digest', '0 7 * * 1', $$select public.call_digest('weekly')$$);
select cron.schedule('pd-reminders', '0 9 * * 1-5', $$select public.call_digest('pd_remind')$$);
