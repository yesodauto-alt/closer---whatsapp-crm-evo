-- Consolidate tenant-aware RLS so each action has one clear policy.

-- USER INTEGRATIONS
drop policy if exists "Users can manage their own integrations" on public.user_integrations;
drop policy if exists "user_integrations_select_org_member" on public.user_integrations;
drop policy if exists "user_integrations_manage_org_admin" on public.user_integrations;

create policy "user_integrations_select_tenant"
on public.user_integrations
for select
to authenticated
using (
  (select auth.uid()) = user_id
  or exists (
    select 1 from public.organizations o
    where o.owner_user_id = user_integrations.user_id
      and private.is_org_member(o.id)
  )
);

create policy "user_integrations_insert_tenant_admin"
on public.user_integrations
for insert
to authenticated
with check (
  (select auth.uid()) = user_id
  or exists (
    select 1 from public.organizations o
    where o.owner_user_id = user_integrations.user_id
      and private.has_org_role(o.id, array['super_admin'::app_role, 'admin'::app_role])
  )
);

create policy "user_integrations_update_tenant_admin"
on public.user_integrations
for update
to authenticated
using (
  (select auth.uid()) = user_id
  or exists (
    select 1 from public.organizations o
    where o.owner_user_id = user_integrations.user_id
      and private.has_org_role(o.id, array['super_admin'::app_role, 'admin'::app_role])
  )
)
with check (
  (select auth.uid()) = user_id
  or exists (
    select 1 from public.organizations o
    where o.owner_user_id = user_integrations.user_id
      and private.has_org_role(o.id, array['super_admin'::app_role, 'admin'::app_role])
  )
);

create policy "user_integrations_delete_tenant_admin"
on public.user_integrations
for delete
to authenticated
using (
  (select auth.uid()) = user_id
  or exists (
    select 1 from public.organizations o
    where o.owner_user_id = user_integrations.user_id
      and private.has_org_role(o.id, array['super_admin'::app_role, 'admin'::app_role])
  )
);

-- WHATSAPP CONTACTS
drop policy if exists "Users can manage their own contacts" on public.whatsapp_contacts;
drop policy if exists "whatsapp_contacts_select_assigned_team" on public.whatsapp_contacts;
drop policy if exists "whatsapp_contacts_manage_org_admin" on public.whatsapp_contacts;

create policy "whatsapp_contacts_select_tenant"
on public.whatsapp_contacts
for select
to authenticated
using (
  (select auth.uid()) = user_id
  or exists (
    select 1 from public.organizations o
    where o.owner_user_id = whatsapp_contacts.user_id
      and private.has_org_role(o.id, array['super_admin'::app_role, 'admin'::app_role])
  )
  or exists (
    select 1 from public.conversation_assignments ca
    where ca.contact_id = whatsapp_contacts.id
      and private.can_access_team(ca.team_id)
  )
);

create policy "whatsapp_contacts_insert_tenant_admin"
on public.whatsapp_contacts
for insert
to authenticated
with check (
  (select auth.uid()) = user_id
  or exists (
    select 1 from public.organizations o
    where o.owner_user_id = whatsapp_contacts.user_id
      and private.has_org_role(o.id, array['super_admin'::app_role, 'admin'::app_role])
  )
);

create policy "whatsapp_contacts_update_tenant_admin"
on public.whatsapp_contacts
for update
to authenticated
using (
  (select auth.uid()) = user_id
  or exists (
    select 1 from public.organizations o
    where o.owner_user_id = whatsapp_contacts.user_id
      and private.has_org_role(o.id, array['super_admin'::app_role, 'admin'::app_role])
  )
)
with check (
  (select auth.uid()) = user_id
  or exists (
    select 1 from public.organizations o
    where o.owner_user_id = whatsapp_contacts.user_id
      and private.has_org_role(o.id, array['super_admin'::app_role, 'admin'::app_role])
  )
);

create policy "whatsapp_contacts_delete_tenant_admin"
on public.whatsapp_contacts
for delete
to authenticated
using (
  (select auth.uid()) = user_id
  or exists (
    select 1 from public.organizations o
    where o.owner_user_id = whatsapp_contacts.user_id
      and private.has_org_role(o.id, array['super_admin'::app_role, 'admin'::app_role])
  )
);

-- WHATSAPP MESSAGES
drop policy if exists "Users can manage their own messages" on public.whatsapp_messages;
drop policy if exists "whatsapp_messages_select_assigned_team" on public.whatsapp_messages;
drop policy if exists "whatsapp_messages_manage_org_admin" on public.whatsapp_messages;

create policy "whatsapp_messages_select_tenant"
on public.whatsapp_messages
for select
to authenticated
using (
  (select auth.uid()) = user_id
  or exists (
    select 1 from public.organizations o
    where o.owner_user_id = whatsapp_messages.user_id
      and private.has_org_role(o.id, array['super_admin'::app_role, 'admin'::app_role])
  )
  or exists (
    select 1 from public.conversation_assignments ca
    where ca.contact_id = whatsapp_messages.contact_id
      and private.can_access_team(ca.team_id)
  )
);

create policy "whatsapp_messages_insert_tenant_admin"
on public.whatsapp_messages
for insert
to authenticated
with check (
  (select auth.uid()) = user_id
  or exists (
    select 1 from public.organizations o
    where o.owner_user_id = whatsapp_messages.user_id
      and private.has_org_role(o.id, array['super_admin'::app_role, 'admin'::app_role])
  )
);

create policy "whatsapp_messages_update_tenant_admin"
on public.whatsapp_messages
for update
to authenticated
using (
  (select auth.uid()) = user_id
  or exists (
    select 1 from public.organizations o
    where o.owner_user_id = whatsapp_messages.user_id
      and private.has_org_role(o.id, array['super_admin'::app_role, 'admin'::app_role])
  )
)
with check (
  (select auth.uid()) = user_id
  or exists (
    select 1 from public.organizations o
    where o.owner_user_id = whatsapp_messages.user_id
      and private.has_org_role(o.id, array['super_admin'::app_role, 'admin'::app_role])
  )
);

create policy "whatsapp_messages_delete_tenant_admin"
on public.whatsapp_messages
for delete
to authenticated
using (
  (select auth.uid()) = user_id
  or exists (
    select 1 from public.organizations o
    where o.owner_user_id = whatsapp_messages.user_id
      and private.has_org_role(o.id, array['super_admin'::app_role, 'admin'::app_role])
  )
);
