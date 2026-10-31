-- Bot-only state. Existing task/report rules remain the source of truth.
create unique index telegram_one_account_per_chat on public.telegram_links(chat_id);
create table public.telegram_bot_drafts (
  chat_id bigint primary key, user_id uuid not null references public.profiles(id) on delete cascade,
  revision bigint not null default 1, data jsonb, expires_at timestamptz not null default now()+interval '2 days'
);
create table public.telegram_bot_updates (
  update_id bigint primary key, chat_id bigint not null, user_id uuid,
  reply jsonb not null, created_at timestamptz not null default now()
);
create table public.telegram_login_claims (
  hash text primary key, chat_id bigint not null, user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index on public.telegram_bot_updates(created_at);
create index on public.telegram_login_claims(chat_id,created_at);
alter table public.telegram_bot_drafts enable row level security;
alter table public.telegram_bot_updates enable row level security;
alter table public.telegram_login_claims enable row level security;
revoke all on public.telegram_bot_drafts,public.telegram_bot_updates,public.telegram_login_claims from public,anon,authenticated,service_role;
grant select,insert,update,delete on public.telegram_bot_drafts,public.telegram_bot_updates,public.telegram_login_claims to service_role;
create policy bot_server_only on public.telegram_bot_drafts for all to service_role using(true) with check(true);
create policy bot_server_only on public.telegram_bot_updates for all to service_role using(true) with check(true);
create policy bot_server_only on public.telegram_login_claims for all to service_role using(true) with check(true);

create function public.telegram_bot_context(p_chat_id bigint) returns jsonb
language plpgsql security invoker set search_path=pg_catalog,public as $$
declare actor uuid; person jsonb; draft public.telegram_bot_drafts%rowtype; today text:=to_char(now() at time zone 'Europe/Moscow','YYYY-MM-DD'); week_start text:=to_char(date_trunc('week',now() at time zone 'Europe/Moscow'),'YYYY-MM-DD');
begin
  select user_id into actor from public.telegram_links where chat_id=p_chat_id;
  select data into person from public.profiles where id=actor and data->>'active'='true' and not coalesce((data->>'pending')::boolean,false);
  select * into draft from public.telegram_bot_drafts where chat_id=p_chat_id and user_id=actor;
  return jsonb_build_object('userId',actor,'me',case when person is null then null else jsonb_build_object('id',actor,'name',person->>'name','role',person->>'role','districtId',person->'districtId') end,
    'revision',coalesce(draft.revision,0),'draft',case when person is not null and draft.expires_at>now() then draft.data else null end,
    'tasks',coalesce((select jsonb_agg(item order by due,id) from (
      select t.id,t.data->>'due' due,jsonb_build_object('id',t.id,'title',t.data->>'title','due',t.data->>'due','metricId',t.data->'metricId','metricName',m.data->>'name','unit',m.data->>'unit','revision',md5(t.data::text)) item
      from public.tasks t left join public.metrics m on m.id=t.data->>'metricId' where person is not null and t.data->>'status' in ('new','in_progress') and (t.data->>'assigneeId'=actor::text or (t.data->'coAssigneeIds') ? actor::text) order by t.data->>'due',t.id limit 200) x),'[]'),
    'reports',coalesce((select jsonb_agg(item order by week desc,id) from (
      select r.id,r.data->>'weekStart' week,jsonb_build_object('id',r.id,'districtId',r.data->>'districtId','districtName',d.data->>'name','weekStart',r.data->>'weekStart','conclusions',coalesce(r.data->>'conclusions',''),'plan',coalesce(r.data->>'plan',''),'problems',coalesce(r.data->>'problems',''),'revision',md5(r.data::text)) item
      from public.reports r left join public.districts d on d.id=r.data->>'districtId' where person is not null and (person->>'role'='head' or (person->>'role'='coordinator' and r.data->>'districtId'=person->>'districtId')) and r.data->>'status' in ('draft','returned')
      union all
      select 'r_'||d.id||'_'||week_start id,week_start week,jsonb_build_object('id','r_'||d.id||'_'||week_start,'districtId',d.id,'districtName',d.data->>'name','weekStart',week_start,'conclusions','','plan','','problems','','revision',null) item
      from public.districts d where person is not null and (person->>'role'='head' or (person->>'role'='coordinator' and d.id=person->>'districtId')) and not exists(select 1 from public.reports r where r.data->>'districtId'=d.id and r.data->>'weekStart'=week_start)
      order by week desc,id limit 36) x),'[]'),
    'daily',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'day',r.day,'done',r.data->>'done','plan',coalesce(r.data->>'plan',''),'problems',coalesce(r.data->>'problems',''),'revision',md5(r.data::text))) from public.daily_reports r where person is not null and r.user_id=actor and r.day between (today::date-2)::text and today),'[]'));
end $$;

create function public.telegram_claim_login(p_hash text,p_chat_id bigint) returns uuid
language plpgsql security invoker set search_path=pg_catalog,public as $$
declare actor uuid;
begin
  if p_hash is null or p_hash !~ '^[a-f0-9]{64}$' or p_chat_id<=0 then raise exception 'Некорректные данные Telegram'; end if;
  perform pg_advisory_xact_lock(p_chat_id);
  select l.user_id into actor from public.telegram_links l join public.profiles p on p.id=l.user_id where l.chat_id=p_chat_id and p.data->>'active'='true' and not coalesce((p.data->>'pending')::boolean,false);
  if actor is null then raise exception 'Telegram не подключён к активной учётной записи'; end if;
  if exists(select 1 from public.telegram_login_claims where hash=p_hash) then raise exception 'Этот вход Telegram уже использован. Повторно откройте мини-приложение'; end if;
  if (select count(*) from public.telegram_login_claims where chat_id=p_chat_id and created_at>now()-interval '1 minute')>=5 then raise exception 'Слишком много попыток входа. Подождите минуту'; end if;
  insert into public.telegram_login_claims(hash,chat_id,user_id) values(p_hash,p_chat_id,actor);
  return actor;
end $$;

create function public.telegram_bot_apply(p_update_id bigint,p_chat_id bigint,p_user_id uuid,p_revision bigint,p_draft jsonb,p_operation jsonb,p_reply jsonb) returns jsonb
language plpgsql security invoker set search_path=pg_catalog,public as $$
declare actor uuid; person jsonb; draft public.telegram_bot_drafts%rowtype; receipt public.telegram_bot_updates%rowtype;
  code_row public.telegram_link_codes%rowtype; current_doc jsonb; doc_id text; base text; fields jsonb; proof jsonb; material jsonb;
  today text:=to_char(now() at time zone 'Europe/Moscow','YYYY-MM-DD'); kind text:=p_operation->>'kind'; flow text; target text; stamp timestamptz:=now();
  previous_claim text:=current_setting('request.jwt.claim.sub',true); recipient uuid; recipients uuid[]:='{}'; coordinator uuid; district text; week_start text:=to_char(date_trunc('week',now() at time zone 'Europe/Moscow'),'YYYY-MM-DD');
begin
  if p_update_id is null or p_update_id<0 or p_chat_id is null or p_chat_id<=0 then raise exception 'Некорректное сообщение Telegram'; end if;
  if jsonb_typeof(p_reply) is distinct from 'array' or jsonb_array_length(p_reply) not between 1 and 20 or length(p_reply::text)>100000 then raise exception 'Некорректный ответ бота'; end if;
  perform pg_advisory_xact_lock(p_chat_id);
  select user_id into actor from public.telegram_links where chat_id=p_chat_id for update;
  select * into receipt from public.telegram_bot_updates where update_id=p_update_id;
  if found then
    if receipt.chat_id<>p_chat_id or receipt.user_id is distinct from actor then raise exception 'Подключение Telegram изменилось. Откройте меню заново'; end if;
    return receipt.reply;
  end if;
  if actor is distinct from p_user_id then raise exception 'Подключение Telegram изменилось. Откройте меню заново'; end if;
  select * into draft from public.telegram_bot_drafts where chat_id=p_chat_id for update;
  if coalesce(draft.revision,0)<>p_revision then raise exception 'Черновик уже изменился. Продолжите его командой /resume'; end if;
  select data into person from public.profiles where id=actor and data->>'active'='true' and not coalesce((data->>'pending')::boolean,false);
  if kind='link' then
    if coalesce(p_operation->>'code','') !~ '^[a-f0-9]{24}$' then raise exception 'Ссылка подключения некорректна'; end if;
    select * into code_row from public.telegram_link_codes where code=p_operation->>'code' for update;
    if code_row.user_id is null or code_row.created_at<now()-interval '24 hours' or code_row.created_at>now()+interval '1 minute' then raise exception 'Ссылка устарела. Создайте новую в профиле на сайте'; end if;
    if not exists(select 1 from public.profiles where id=code_row.user_id and data->>'active'='true' and not coalesce((data->>'pending')::boolean,false)) then raise exception 'Учётная запись отключена или ожидает подтверждения'; end if;
    if actor is not null and actor<>code_row.user_id then raise exception 'Этот Telegram уже связан с другой учётной записью. Сначала выполните /stop'; end if;
    if exists(select 1 from public.telegram_links where user_id=code_row.user_id and chat_id<>p_chat_id) then raise exception 'Профиль уже связан с другим Telegram. Сначала отключите его в профиле на сайте'; end if;
    insert into public.telegram_links(user_id,chat_id) values(code_row.user_id,p_chat_id) on conflict(user_id) do update set linked_at=now();
    actor:=code_row.user_id;
    delete from public.telegram_link_codes where user_id=actor;
    delete from public.telegram_bot_drafts where chat_id=p_chat_id;
  elsif kind='unlink' then
    delete from public.telegram_links where chat_id=p_chat_id;
    delete from public.telegram_bot_drafts where chat_id=p_chat_id;
    actor:=null;
  elsif kind='submit' then
    if person is null or draft.user_id is distinct from actor or draft.expires_at<=now() or draft.data->>'stage'<>'confirm' or draft.data->>'nonce' is distinct from p_operation->>'nonce' then raise exception 'Черновик недоступен или кнопка устарела. Продолжите через /resume'; end if;
    flow:=draft.data->>'kind'; target:=draft.data->>'target'; base:=draft.data->>'base'; fields:=draft.data->'fields';
    if jsonb_typeof(fields) is distinct from 'object' then raise exception 'Черновик повреждён'; end if;
    if exists(select 1 from jsonb_each(fields) where jsonb_typeof(value)<>'string' or length(value#>>'{}')>3000) then raise exception 'Текст отчёта слишком длинный или повреждён'; end if;
    perform set_config('request.jwt.claim.sub',actor::text,true);
    if flow='daily' then
      if person->>'role' not in ('head','staff','coordinator') then raise exception 'Отчёт дня недоступен вашей роли'; end if;
      if coalesce(target,'') !~ '^\d{4}-\d{2}-\d{2}$' or target<(today::date-2)::text or target>today or to_char(target::date,'YYYY-MM-DD')<>target then raise exception 'Отчёт дня можно заполнить за сегодня и два предыдущих дня'; end if;
      if length(trim(coalesce(fields->>'done','')))<10 then raise exception 'Опишите, что сделано за день'; end if;
      select id,data into doc_id,current_doc from public.daily_reports where user_id=actor and day=target for update;
      if (case when current_doc is null then null else md5(current_doc::text) end) is distinct from base then raise exception 'Отчёт изменился на сайте. Обновите версию в боте и сверьте данные перед подтверждением'; end if;
      if doc_id is null then
        doc_id:='dr_'||actor::text||'_'||target;
        current_doc:=jsonb_build_object('id',doc_id,'userId',actor,'day',target,'done',trim(fields->>'done'),'plan',trim(coalesce(fields->>'plan','')),'problems',trim(coalesce(fields->>'problems','')),'updatedAt',stamp);
        insert into public.daily_reports(id,user_id,day,data) values(doc_id,actor,target,current_doc);
      else
        current_doc:=current_doc||jsonb_build_object('done',trim(fields->>'done'),'plan',trim(coalesce(fields->>'plan','')),'problems',trim(coalesce(fields->>'problems','')),'updatedAt',stamp);
        update public.daily_reports set data=current_doc where id=doc_id and user_id=actor and day=target;
      end if;
    elsif flow='weekly' then
      select data into current_doc from public.reports where id=target for update;
      if current_doc is null then
        select d.id into district from public.districts d where target='r_'||d.id||'_'||week_start and (person->>'role'='head' or (person->>'role'='coordinator' and person->>'districtId'=d.id));
        if district is null or base is not null then raise exception 'Отчёт недоступен. Обновите список через /resume'; end if;
        insert into public.reports(id,data) values(target,jsonb_build_object('id',target,'districtId',district,'weekStart',week_start,'status','draft','conclusions','','plan','','problems','','history','[]'::jsonb,'updatedAt',stamp)) returning data into current_doc;
      elsif md5(current_doc::text) is distinct from base then raise exception 'Отчёт изменился на сайте. Обновите версию в боте и сверьте данные перед подтверждением'; end if;
      if current_doc is null or current_doc->>'status' not in ('draft','returned') or not (person->>'role'='head' or (person->>'role'='coordinator' and person->>'districtId'=current_doc->>'districtId')) then raise exception 'Отчёт уже отправлен или недоступен вашей роли'; end if;
      if length(trim(coalesce(fields->>'conclusions','')))=0 then raise exception 'Заполните выводы недельного отчёта'; end if;
      update public.reports set data=current_doc||jsonb_build_object('conclusions',trim(fields->>'conclusions'),'plan',trim(coalesce(fields->>'plan','')),'problems',trim(coalesce(fields->>'problems','')),'status','sent','updatedAt',stamp,'history',coalesce(current_doc->'history','[]')||jsonb_build_array(jsonb_build_object('at',stamp,'userId',actor,'text','Отправил(а) отчёт на проверку через Telegram'))) where id=target;
      recipients:=array(select id from public.profiles where data->>'role'='head' and data->>'active'='true' and not coalesce((data->>'pending')::boolean,false));
    elsif flow='result' then
      select data into current_doc from public.tasks where id=target for update;
      if current_doc is null or current_doc->>'status' not in ('new','in_progress') or not (current_doc->>'assigneeId'=actor::text or (current_doc->'coAssigneeIds') ? actor::text) then raise exception 'Задача уже сдана или вы больше не являетесь ответственным или соисполнителем'; end if;
      if md5(current_doc::text) is distinct from base then raise exception 'Задача изменилась на сайте. Обновите версию в боте и сверьте данные перед подтверждением'; end if;
      if length(trim(coalesce(fields->>'text','')))<5 then raise exception 'Опишите результат задачи'; end if;
      if current_doc->>'metricId' is not null and (coalesce(fields->>'value','') !~ '^\d+(\.\d+)?$' or (fields->>'value')::numeric>1000000000000) then raise exception 'Укажите фактическое значение показателя от 0 до 1000000000000'; end if;
      proof:=draft.data->'attachments';
      if jsonb_typeof(proof) is distinct from 'array' or jsonb_array_length(proof)>10 then raise exception 'Материалы задачи повреждены'; end if;
      for material in select value from jsonb_array_elements(proof) loop
        if jsonb_typeof(material) is distinct from 'object' or length(coalesce(material->>'name','')) not between 1 and 2000 or (material->>'kind'='link' and coalesce(material->>'url','') !~* '^https?://') or (material->>'kind' in ('photo','file') and (coalesce(material->>'url','') not like 'sb://attachments/'||actor::text||'/telegram/'||(draft.data->>'id')||'/%' or material->>'url' like '%..%')) or coalesce(material->>'kind','') not in ('link','photo','file') then raise exception 'Материалы задачи недоступны'; end if;
      end loop;
      current_doc:=current_doc||jsonb_build_object('status','review','result',jsonb_build_object('text',trim(fields->>'text'),'attachments',proof,'submittedAt',stamp,'submittedDate',today),
        'comments',coalesce(current_doc->'comments','[]')||jsonb_build_array(jsonb_build_object('id','tg_result_'||p_update_id::text,'authorId',actor,'text',trim(fields->>'text'),'at',stamp,'kind','result')),
        'history',coalesce(current_doc->'history','[]')||jsonb_build_array(jsonb_build_object('at',stamp,'userId',actor,'text','Отправил(а) результат на проверку через Telegram')));
      if current_doc->>'metricId' is not null then current_doc:=jsonb_set(current_doc,'{result,value}',to_jsonb((fields->>'value')::numeric)); end if;
      update public.tasks set data=current_doc where id=target;
      select p.id into coordinator from public.districts d join public.profiles p on p.id::text=d.data->>'coordinatorId' and p.data->>'active'='true' and not coalesce((p.data->>'pending')::boolean,false) where d.id=current_doc->>'districtId';
      if coordinator is not null then recipients:=array[coordinator]; end if;
      if coordinator is null or coordinator=actor then recipients:=recipients||array(select id from public.profiles where data->>'role'='head' and data->>'active'='true' and not coalesce((data->>'pending')::boolean,false)); end if;
    else raise exception 'Неизвестный вид отчёта'; end if;
    foreach recipient in array recipients loop
      if recipient=actor then continue; end if;
      insert into public.notifications(id,user_id,data) values('tg_'||p_update_id::text||'_'||recipient::text,recipient,jsonb_build_object('id','tg_'||p_update_id::text||'_'||recipient::text,'userId',recipient,'text',case when flow='result' then (person->>'name')||' отправил(а) результат на проверку: «'||(current_doc->>'title')||'»' else 'Недельный отчёт округа отправлен на проверку через Telegram' end,'at',stamp,'read',false,'kind',case when flow='result' then 'review' else 'report' end,'link',case when flow='result' then '#/tasks/' else '#/reports/' end||target));
    end loop;
    perform set_config('request.jwt.claim.sub',coalesce(previous_claim,''),true);
    insert into public.telegram_bot_drafts(chat_id,user_id,revision,data) values(p_chat_id,actor,p_revision+1,null) on conflict(chat_id) do update set revision=excluded.revision,data=null,expires_at=now()+interval '2 days';
  elsif kind is not null then raise exception 'Неизвестное действие Telegram';
  else
    if p_draft is not null and (person is null or jsonb_typeof(p_draft) is distinct from 'object' or coalesce(p_draft->>'kind','') not in ('daily','weekly','result') or coalesce(p_draft->>'id','') !~ '^[a-f0-9-]{36}$' or coalesce(p_draft->>'nonce','') !~ '^[a-f0-9]{16}$' or length(p_draft::text)>60000) then raise exception 'Черновик недоступен или повреждён'; end if;
    if actor is not null then
      insert into public.telegram_bot_drafts(chat_id,user_id,revision,data) values(p_chat_id,actor,p_revision+1,case when person is null then draft.data else p_draft end) on conflict(chat_id) do update set user_id=excluded.user_id,revision=excluded.revision,data=excluded.data,expires_at=now()+interval '2 days';
    end if;
  end if;
  insert into public.telegram_bot_updates(update_id,chat_id,user_id,reply) values(p_update_id,p_chat_id,actor,p_reply);
  return p_reply;
end $$;

revoke all on function public.telegram_bot_context(bigint),public.telegram_claim_login(text,bigint),public.telegram_bot_apply(bigint,bigint,uuid,bigint,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.telegram_bot_context(bigint),public.telegram_claim_login(text,bigint),public.telegram_bot_apply(bigint,bigint,uuid,bigint,jsonb,jsonb,jsonb) to service_role;
do $$ begin
  if exists(select 1 from pg_extension where extname='pg_cron') then
    perform cron.schedule('telegram-bot-cleanup','23 * * * *',$job$delete from public.telegram_bot_updates where created_at<now()-interval '2 days'; delete from public.telegram_login_claims where created_at<now()-interval '1 day'; delete from public.telegram_bot_drafts where expires_at<now()-interval '30 days';$job$);
  end if;
end $$;
