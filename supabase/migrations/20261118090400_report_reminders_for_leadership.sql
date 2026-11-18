-- Remind leadership about their own report too, without including optional reports in performance totals.
create or replace function public.daily_report_reminders() returns void language plpgsql security definer set search_path='' as $$
declare today text := public.msk_today();
begin
 if extract(isodow from now() at time zone 'Europe/Moscow')>5 then return; end if;
 insert into public.notifications(id,user_id,data)
 select 'dr_'||p.id::text||'_'||today,p.id,
 jsonb_build_object('id','dr_'||p.id::text||'_'||today,'userId',p.id::text,'at',now(),'read',false,'link','#/daily','kind','report',
 'text',(array['Итоги дня ещё не сохранены. Добавьте выполненные дела, трудности и план в отчёт дня.','Перед завершением рабочего дня заполните отчёт: что получилось и где нужна помощь.','Пора подвести итоги: отчёт за сегодня пока не заполнен. Откройте его и сохраните результаты.'])[1+mod(extract(doy from now())::int+ascii(right(p.id::text,1)),3)])
 from public.profiles p where coalesce((p.data->>'active')::boolean,true) and not coalesce((p.data->>'pending')::boolean,false)
 and p.data->>'role' in ('head','staff','coordinator')
 and not exists(select 1 from public.daily_reports r where r.user_id=p.id and r.day=today)
 on conflict(id) do nothing;
end $$;
revoke all on function public.daily_report_reminders() from public,anon,authenticated;

