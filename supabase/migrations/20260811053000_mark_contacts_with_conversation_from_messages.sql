create or replace function private.mark_contact_has_conversation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.whatsapp_contacts
  set has_conversation = true
  where id = new.contact_id
    and has_conversation = false;
  return new;
end;
$$;

drop trigger if exists whatsapp_messages_mark_contact_conversation on public.whatsapp_messages;
create trigger whatsapp_messages_mark_contact_conversation
after insert or update of contact_id on public.whatsapp_messages
for each row execute function private.mark_contact_has_conversation();
