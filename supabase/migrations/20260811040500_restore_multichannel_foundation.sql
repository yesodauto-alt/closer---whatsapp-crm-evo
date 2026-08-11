-- Restore the multichannel architecture that existed before the migration.
-- Phase 1 is backwards-compatible: it adds channel/integration identity and
-- backfills the currently connected WhatsApp without removing legacy uniques.

create table if not exists public.channels (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  type text not null default 'whatsapp',
  provider text not null default 'evolution',
  status text not null default 'DISCONNECTED',
  phone_number text,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  last_sync_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint channels_type_check check (type in ('whatsapp','email','telegram')),
  constraint channels_provider_check check (provider in ('evolution','meta_cloud','email','telegram'))
);

create index if not exists channels_organization_id_idx
  on public.channels(organization_id);
create index if not exists channels_status_idx
  on public.channels(organization_id, status);

alter table public.channels enable row level security;

drop policy if exists channels_select_org_member on public.channels;
create policy channels_select_org_member
on public.channels for select to authenticated
using (private.is_org_member(organization_id));

drop policy if exists channels_insert_org_admin on public.channels;
create policy channels_insert_org_admin
on public.channels for insert to authenticated
with check (
  private.has_org_role(
    organization_id,
    array['super_admin'::app_role, 'admin'::app_role]
  )
);

drop policy if exists channels_update_org_admin on public.channels;
create policy channels_update_org_admin
on public.channels for update to authenticated
using (
  private.has_org_role(
    organization_id,
    array['super_admin'::app_role, 'admin'::app_role]
  )
)
with check (
  private.has_org_role(
    organization_id,
    array['super_admin'::app_role, 'admin'::app_role]
  )
);

drop policy if exists channels_delete_org_admin on public.channels;
create policy channels_delete_org_admin
on public.channels for delete to authenticated
using (
  private.has_org_role(
    organization_id,
    array['super_admin'::app_role, 'admin'::app_role]
  )
);

alter table public.user_integrations
  add column if not exists channel_id uuid references public.channels(id) on delete restrict,
  add column if not exists is_primary boolean not null default false,
  add column if not exists provider text not null default 'evolution';

-- One provider integration belongs to at most one channel. Multiple integrations
-- per tenant are enabled only in phase 2, after the application code is deployed.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'user_integrations_channel_id_key'
      and conrelid = 'public.user_integrations'::regclass
  ) then
    alter table public.user_integrations
      add constraint user_integrations_channel_id_key unique(channel_id);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'user_integrations_instance_name_key'
      and conrelid = 'public.user_integrations'::regclass
  ) then
    alter table public.user_integrations
      add constraint user_integrations_instance_name_key unique(instance_name);
  end if;
end $$;

-- Restore a channel record for every legacy integration. Metadata is used only
-- during the deterministic backfill and does not expose secrets.
insert into public.channels (
  organization_id,
  name,
  type,
  provider,
  status,
  is_active,
  metadata,
  created_by,
  created_at,
  updated_at
)
select
  o.id,
  'WhatsApp principal',
  'whatsapp',
  'evolution',
  coalesce(ui.status, 'DISCONNECTED'),
  true,
  jsonb_build_object('legacy_integration_id', ui.id::text),
  o.owner_user_id,
  coalesce(ui.created_at, now()),
  coalesce(ui.updated_at, now())
from public.user_integrations ui
join public.organizations o on o.owner_user_id = ui.user_id
where ui.channel_id is null
  and not exists (
    select 1 from public.channels c
    where c.metadata ->> 'legacy_integration_id' = ui.id::text
  );

update public.user_integrations ui
set
  channel_id = c.id,
  is_primary = true,
  provider = 'evolution'
from public.channels c
where ui.channel_id is null
  and c.metadata ->> 'legacy_integration_id' = ui.id::text;

alter table public.whatsapp_contacts
  add column if not exists integration_id uuid references public.user_integrations(id) on delete restrict;

alter table public.whatsapp_messages
  add column if not exists integration_id uuid references public.user_integrations(id) on delete restrict;

-- Existing production data belongs to the current primary integration.
update public.whatsapp_contacts c
set integration_id = ui.id
from public.user_integrations ui
where c.integration_id is null
  and ui.user_id = c.user_id
  and ui.is_primary = true;

update public.whatsapp_messages m
set integration_id = coalesce(c.integration_id, ui.id)
from public.whatsapp_contacts c
left join public.user_integrations ui
  on ui.user_id = m.user_id and ui.is_primary = true
where m.integration_id is null
  and c.id = m.contact_id;

-- New conflict targets used by multichannel-aware Edge Functions. Legacy unique
-- constraints remain until phase 2 so the currently deployed functions keep working.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'whatsapp_contacts_integration_remote_jid_key'
      and conrelid = 'public.whatsapp_contacts'::regclass
  ) then
    alter table public.whatsapp_contacts
      add constraint whatsapp_contacts_integration_remote_jid_key
      unique(integration_id, remote_jid);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'whatsapp_messages_integration_message_id_key'
      and conrelid = 'public.whatsapp_messages'::regclass
  ) then
    alter table public.whatsapp_messages
      add constraint whatsapp_messages_integration_message_id_key
      unique(integration_id, message_id);
  end if;
end $$;

create index if not exists whatsapp_contacts_integration_id_idx
  on public.whatsapp_contacts(integration_id);
create index if not exists whatsapp_messages_integration_id_idx
  on public.whatsapp_messages(integration_id);
