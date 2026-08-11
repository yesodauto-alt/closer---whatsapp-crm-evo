drop policy if exists "user_integrations_select_org_member" on public.user_integrations;
create policy "user_integrations_select_org_member"
on public.user_integrations
for select
to authenticated
using (
  exists (
    select 1
    from public.organizations o
    where o.owner_user_id = user_integrations.user_id
      and private.is_org_member(o.id)
  )
);

drop policy if exists "user_integrations_manage_org_admin" on public.user_integrations;
create policy "user_integrations_manage_org_admin"
on public.user_integrations
for all
to authenticated
using (
  exists (
    select 1
    from public.organizations o
    where o.owner_user_id = user_integrations.user_id
      and private.has_org_role(o.id, array['super_admin'::app_role, 'admin'::app_role])
  )
)
with check (
  exists (
    select 1
    from public.organizations o
    where o.owner_user_id = user_integrations.user_id
      and private.has_org_role(o.id, array['super_admin'::app_role, 'admin'::app_role])
  )
);

drop policy if exists "whatsapp_contacts_manage_org_admin" on public.whatsapp_contacts;
create policy "whatsapp_contacts_manage_org_admin"
on public.whatsapp_contacts
for all
to authenticated
using (
  exists (
    select 1
    from public.organizations o
    where o.owner_user_id = whatsapp_contacts.user_id
      and private.has_org_role(o.id, array['super_admin'::app_role, 'admin'::app_role])
  )
)
with check (
  exists (
    select 1
    from public.organizations o
    where o.owner_user_id = whatsapp_contacts.user_id
      and private.has_org_role(o.id, array['super_admin'::app_role, 'admin'::app_role])
  )
);

drop policy if exists "whatsapp_messages_manage_org_admin" on public.whatsapp_messages;
create policy "whatsapp_messages_manage_org_admin"
on public.whatsapp_messages
for all
to authenticated
using (
  exists (
    select 1
    from public.organizations o
    where o.owner_user_id = whatsapp_messages.user_id
      and private.has_org_role(o.id, array['super_admin'::app_role, 'admin'::app_role])
  )
)
with check (
  exists (
    select 1
    from public.organizations o
    where o.owner_user_id = whatsapp_messages.user_id
      and private.has_org_role(o.id, array['super_admin'::app_role, 'admin'::app_role])
  )
);
