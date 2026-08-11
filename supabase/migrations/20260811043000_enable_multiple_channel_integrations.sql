-- Phase 2: application code is now multichannel-aware, so remove the legacy
-- tenant-wide uniqueness that limited each organization to a single WhatsApp.

alter table public.user_integrations
  drop constraint if exists user_integrations_user_id_key;

alter table public.whatsapp_contacts
  drop constraint if exists whatsapp_contacts_user_id_remote_jid_key;

alter table public.whatsapp_messages
  drop constraint if exists whatsapp_messages_user_id_message_id_key;

-- Preserve exactly one primary integration per tenant while allowing any number
-- of additional channel integrations.
create unique index if not exists user_integrations_one_primary_per_user_idx
  on public.user_integrations(user_id)
  where is_primary = true;

create index if not exists user_integrations_user_id_idx
  on public.user_integrations(user_id);
