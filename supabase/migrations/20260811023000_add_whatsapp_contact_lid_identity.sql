alter table public.whatsapp_contacts
  add column if not exists lid_jid text;

create index if not exists whatsapp_contacts_user_lid_idx
  on public.whatsapp_contacts(user_id, lid_jid)
  where lid_jid is not null;

comment on column public.whatsapp_contacts.lid_jid is
  'WhatsApp Linked ID (@lid), kept separate from the canonical phone-based remote_jid and phone_number.';
