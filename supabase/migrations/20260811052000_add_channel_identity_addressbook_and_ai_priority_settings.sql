alter table public.organizations
  add column if not exists conversation_sort text not null default 'priority',
  add column if not exists priority_categories jsonb not null default '[{"code":"Hot","label":"Quente","minScore":80,"color":"#ef4444"},{"code":"Warm","label":"Morno","minScore":60,"color":"#f97316"},{"code":"Lukewarm","label":"Em avaliação","minScore":40,"color":"#eab308"},{"code":"Cold","label":"Frio","minScore":1,"color":"#3b82f6"},{"code":"Do Not Contact","label":"Não contatar","minScore":0,"color":"#64748b"}]'::jsonb,
  add column if not exists auto_triage_enabled boolean not null default false,
  add column if not exists triage_agent_id uuid references public.ai_agents(id) on delete set null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'organizations_conversation_sort_check'
      and conrelid = 'public.organizations'::regclass
  ) then
    alter table public.organizations
      add constraint organizations_conversation_sort_check
      check (conversation_sort in ('priority','recent','oldest'));
  end if;
end $$;

alter table public.ai_agents
  add column if not exists triage_enabled boolean not null default false,
  add column if not exists triage_instructions text,
  add column if not exists triage_history_limit integer not null default 40;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'ai_agents_triage_history_limit_check'
      and conrelid = 'public.ai_agents'::regclass
  ) then
    alter table public.ai_agents
      add constraint ai_agents_triage_history_limit_check
      check (triage_history_limit between 5 and 200);
  end if;
end $$;

alter table public.whatsapp_contacts
  add column if not exists is_address_book boolean not null default false,
  add column if not exists has_conversation boolean not null default false,
  add column if not exists classification_updated_at timestamptz;

update public.whatsapp_contacts c
set has_conversation = true
where exists (
  select 1 from public.whatsapp_messages m where m.contact_id = c.id
);

create index if not exists whatsapp_contacts_conversation_queue_idx
  on public.whatsapp_contacts(user_id, has_conversation, score desc, last_message_at desc);

create index if not exists whatsapp_contacts_address_book_idx
  on public.whatsapp_contacts(user_id, is_address_book)
  where is_address_book = true;
