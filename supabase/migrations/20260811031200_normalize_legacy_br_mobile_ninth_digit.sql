-- Normalize Brazilian mobile numbers still stored in the pre-ninth-digit format.
-- Safety rules:
--   * only country code 55;
--   * exactly 10 national digits (DDD + 8-digit subscriber);
--   * subscriber starts with 6-9 (legacy mobile ranges);
--   * fixed lines starting with 2-5 are untouched;
--   * skip rows when the canonical phone/JID already belongs to another contact.

with candidates as (
  select
    c.id,
    c.user_id,
    c.phone_number,
    ('55' || substr(c.phone_number, 3, 2) || '9' || substr(c.phone_number, 5)) as canonical_phone
  from public.whatsapp_contacts c
  where c.phone_number ~ '^55[1-9][0-9][6-9][0-9]{7}$'
), safe_candidates as (
  select x.*
  from candidates x
  where not exists (
    select 1
    from public.whatsapp_contacts other
    where other.user_id = x.user_id
      and other.id <> x.id
      and (
        other.phone_number = x.canonical_phone
        or other.remote_jid = x.canonical_phone || '@s.whatsapp.net'
      )
  )
)
update public.whatsapp_contacts c
set
  phone_number = s.canonical_phone,
  remote_jid = case
    when c.remote_jid = s.phone_number || '@s.whatsapp.net'
      then s.canonical_phone || '@s.whatsapp.net'
    else c.remote_jid
  end
from safe_candidates s
where c.id = s.id;
