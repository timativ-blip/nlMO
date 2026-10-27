-- Хранилище вложений (приватное, доступ по подписанным ссылкам)
insert into storage.buckets (id, name, public, file_size_limit)
values ('attachments', 'attachments', false, 10485760)
on conflict (id) do nothing;
create policy att_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'attachments' and (storage.foldername(name))[1] = auth.uid()::text and public.my_role() is not null);
create policy att_read on storage.objects for select to authenticated
  using (bucket_id = 'attachments' and public.my_role() is not null);

-- Служебные функции нельзя вызвать через API — только триггерами и планировщиком
revoke execute on function public.deadline_reminders(), public.events_guard(), public.notify_telegram(), public.profiles_guard(),
  public.reports_guard(), public.tasks_insert_guard(), public.tasks_update_guard(), public.write_audit() from public, anon, authenticated;
revoke execute on function public.my_role(), public.my_district(), public.is_manager(), public.is_head(), public.is_coord_of(text), public.can_assign(text), public.msk_today() from public, anon;
grant execute on function public.my_role(), public.my_district(), public.is_manager(), public.is_head(), public.is_coord_of(text), public.can_assign(text), public.msk_today() to authenticated;
