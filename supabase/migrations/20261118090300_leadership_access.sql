-- These titles use the same access level as the head, including on older profiles.
update public.profiles set data = jsonb_set(data, '{role}', '"head"')
where data->>'title' in ('developer', 'deputy') and data->>'role' is distinct from 'head';

create function hq_private.leadership_access() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (new.data->>'role' = 'member' and (tg_op = 'INSERT' or new.data->>'role' is distinct from old.data->>'role'))
    or (new.data->>'title' in ('member', 'party_member') and (tg_op = 'INSERT' or new.data->>'title' is distinct from old.data->>'title')) then
    raise exception 'Выберите действующую роль команды';
  end if;
  if new.data->>'title' in ('developer', 'deputy') then
    new.data := jsonb_set(new.data, '{role}', '"head"');
  end if;
  return new;
end $$;
revoke all on function hq_private.leadership_access() from public, anon, authenticated;
-- Run before profiles_guard so the existing role authorization checks the normalized value.
create trigger profiles_access_level before insert or update on public.profiles
for each row execute function hq_private.leadership_access();
