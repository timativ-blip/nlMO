-- Each device opts in independently. Existing Telegram delivery remains unchanged.
create table public.push_subscriptions (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.profiles(id) on delete cascade,
 endpoint text not null unique check(length(endpoint)<=2048),
 subscription jsonb not null,
 muted text[] not null default '{}',
 updated_at timestamptz not null default now()
);
create index push_subscriptions_user on public.push_subscriptions(user_id);
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon,authenticated;
grant select,delete on public.push_subscriptions to authenticated;
grant all on public.push_subscriptions to service_role;
create policy push_device_read on public.push_subscriptions for select to authenticated using(user_id=(select auth.uid()));
create policy push_device_delete on public.push_subscriptions for delete to authenticated using(user_id=(select auth.uid()));

create table public.push_deliveries (
 notification_id text not null references public.notifications(id) on delete cascade,
 subscription_id uuid not null references public.push_subscriptions(id) on delete cascade,
 state text not null default 'pending' check(state in ('pending','working','done')),
 attempts integer not null default 0,
 available_at timestamptz not null default now(),
 locked_until timestamptz,
 last_status integer,
 created_at timestamptz not null default now(),
 primary key(notification_id,subscription_id)
);
create index push_deliveries_pending on public.push_deliveries(available_at) where state<>'done';
alter table public.push_deliveries enable row level security;
revoke all on public.push_deliveries from anon,authenticated;
grant all on public.push_deliveries to service_role;
create schema if not exists app_private;

create function app_private.dispatch_push() returns void language plpgsql security definer set search_path=public,extensions as $$
declare base text; hook text;
begin
 delete from public.push_deliveries where created_at<now()-interval '2 days';
 if not exists(select 1 from public.push_deliveries where state='pending' and available_at<=now() or state='working' and locked_until<now()) then return; end if;
 select value into base from public.app_secrets where key='functions_url';
 select value into hook from public.app_secrets where key='hook_secret';
 if base is null or hook is null then return; end if;
 perform net.http_post(url:=base||'/web-push',body:='{"action":"dispatch"}'::jsonb,headers:=jsonb_build_object('Content-Type','application/json','x-hook-secret',hook),timeout_milliseconds:=15000);
end $$;
revoke all on function app_private.dispatch_push() from public,anon,authenticated;

create function app_private.queue_notification_push() returns trigger language plpgsql security definer set search_path=public as $$
begin
 insert into public.push_deliveries(notification_id,subscription_id)
 select new.id,s.id from public.push_subscriptions s join public.profiles p on p.id=s.user_id
 where s.user_id=new.user_id and not coalesce((new.data->>'read')::boolean,false)
 and not (coalesce(new.data->>'kind','assign')=any(s.muted))
 and coalesce((p.data->>'active')::boolean,true) and not coalesce((p.data->>'pending')::boolean,false)
 and p.data->>'role' in ('head','staff','coordinator')
 on conflict do nothing;
 perform app_private.dispatch_push();
 return new;
end $$;
revoke all on function app_private.queue_notification_push() from public,anon,authenticated;
create trigger notifications_push after insert on public.notifications for each row execute function app_private.queue_notification_push();

create function public.claim_push_deliveries() returns table(notification_id text,subscription_id uuid,subscription jsonb,notification jsonb,attempts integer,enabled boolean)
language sql security definer set search_path=public as $$
 with selected as (
  select j.notification_id,j.subscription_id from public.push_deliveries j
  where j.attempts<5 and j.created_at>now()-interval '1 day' and ((j.state='pending' and j.available_at<=now()) or (j.state='working' and j.locked_until<now()))
  order by j.available_at for update skip locked limit 40
 ), claimed as (
  update public.push_deliveries j set state='working',locked_until=now()+interval '2 minutes',attempts=j.attempts+1
  from selected q where j.notification_id=q.notification_id and j.subscription_id=q.subscription_id returning j.*
 )
 select j.notification_id,j.subscription_id,s.subscription,n.data,j.attempts,
  coalesce((p.data->>'active')::boolean,true) and not coalesce((p.data->>'pending')::boolean,false) and p.data->>'role' in ('head','staff','coordinator')
  and not coalesce((n.data->>'read')::boolean,false) and not (coalesce(n.data->>'kind','assign')=any(s.muted)) and n.user_id=s.user_id
 from claimed j join public.push_subscriptions s on s.id=j.subscription_id join public.notifications n on n.id=j.notification_id join public.profiles p on p.id=s.user_id;
$$;
revoke all on function public.claim_push_deliveries() from public,anon,authenticated;
grant execute on function public.claim_push_deliveries() to service_role;
select cron.schedule('web-push-delivery','* * * * *','select app_private.dispatch_push()');

-- Rotate concise, actionable copy without creating duplicate reminders on retries.
create or replace function public.daily_report_reminders() returns void language plpgsql security definer set search_path=public as $$
declare today text:=msk_today();
begin
 if extract(isodow from now() at time zone 'Europe/Moscow')>5 then return; end if;
 insert into public.notifications(id,user_id,data)
 select 'dr_'||p.id::text||'_'||today,p.id,
 jsonb_build_object('id','dr_'||p.id::text||'_'||today,'userId',p.id::text,'at',now(),'read',false,'link','#/daily','kind','report',
 'text',(array['Итоги дня ещё не сохранены. Добавьте выполненные дела, трудности и план в отчёт дня.','Перед завершением рабочего дня заполните отчёт: что получилось и где нужна помощь.','Пора подвести итоги: отчёт за сегодня пока не заполнен. Откройте его и сохраните результаты.'])[1+mod(extract(doy from now())::int+ascii(right(p.id::text,1)),3)])
 from public.profiles p where coalesce((p.data->>'active')::boolean,true) and not coalesce((p.data->>'pending')::boolean,false)
 and p.data->>'role' in ('staff','coordinator')
 and not exists(select 1 from public.daily_reports r where r.user_id=p.id and r.day=today)
 on conflict(id) do nothing;
end $$;
revoke all on function public.daily_report_reminders() from public,anon,authenticated;

create or replace function public.deadline_reminders() returns void language plpgsql security definer set search_path=public as $$
declare today text:=msk_today(); tomorrow text:=to_char((now() at time zone 'Europe/Moscow')::date+1,'YYYY-MM-DD');
begin
 insert into public.notifications(id,user_id,data)
 select 'dl_'||t.id||'_'||p.id::text||'_'||today,p.id,
 jsonb_build_object('id','dl_'||t.id||'_'||p.id::text||'_'||today,'userId',p.id::text,'at',now(),'read',false,'link','#/tasks/'||t.id,'kind','deadline',
 'text',format(case when t.data->>'due'=today then (array['Сегодня срок задачи «%s». Отправьте результат на проверку.','На сегодня запланирована задача «%s». Проверьте готовность и приложите результат.','До конца дня нужно завершить «%s». Если есть трудности, сообщите о них в задаче.'])[1+mod(extract(doy from now())::int+ascii(right(p.id::text,1)),3)] else 'Завтра срок задачи «%s». Проверьте, всё ли готово к сдаче.' end,t.data->>'title'))
 from public.tasks t join public.profiles p on p.id::text=t.data->>'assigneeId' or coalesce(t.data->'coAssigneeIds','[]'::jsonb)?p.id::text
 where t.data->>'status' in ('new','in_progress') and t.data->>'due' in (today,tomorrow)
 and coalesce((p.data->>'active')::boolean,true) and not coalesce((p.data->>'pending')::boolean,false) and p.data->>'role' in ('head','staff','coordinator')
 on conflict(id) do nothing;
end $$;
revoke all on function public.deadline_reminders() from public,anon,authenticated;

create function app_private.weekly_report_reminders() returns void language plpgsql security definer set search_path=public as $$
declare day date:=(now() at time zone 'Europe/Moscow')::date; ws text; finish text;
begin
 ws:=to_char(day-(extract(isodow from day)::int-1)-case when extract(isodow from day)=1 then 7 else 0 end,'YYYY-MM-DD');
 finish:=to_char(ws::date+6,'DD.MM');
 insert into public.notifications(id,user_id,data)
 select 'wr_'||p.id::text||'_'||day::text,p.id,jsonb_build_object('id','wr_'||p.id::text||'_'||day::text,'userId',p.id::text,'at',now(),'read',false,'link','#/reports','kind','report',
 'text',format((array['Недельный отчёт округа за %s–%s ещё не отправлен. Проверьте показатели и дополните выводы.','Соберите итоги недели %s–%s: результаты, сложности и дальнейший план. Отчёт пока не сдан.','Осталось подвести итоги за %s–%s. Откройте недельный отчёт и отправьте его на проверку.'])[1+mod(extract(doy from day)::int+ascii(right(p.id::text,1)),3)],to_char(ws::date,'DD.MM'),finish))
 from public.profiles p where p.data->>'role'='coordinator' and p.data->>'districtId' is not null
 and coalesce((p.data->>'active')::boolean,true) and not coalesce((p.data->>'pending')::boolean,false)
 and not exists(select 1 from public.reports r where r.data->>'districtId'=p.data->>'districtId' and r.data->>'weekStart'=ws and r.data->>'status' in ('submitted','accepted'))
 on conflict(id) do nothing;
end $$;
revoke all on function app_private.weekly_report_reminders() from public,anon,authenticated;
select cron.schedule('weekly-report-friday','0 14 * * 5','select app_private.weekly_report_reminders()');
select cron.schedule('weekly-report-monday','0 6 * * 1','select app_private.weekly_report_reminders()');
