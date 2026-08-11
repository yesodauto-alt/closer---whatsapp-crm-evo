create index if not exists organizations_triage_agent_id_idx
  on public.organizations(triage_agent_id)
  where triage_agent_id is not null;
