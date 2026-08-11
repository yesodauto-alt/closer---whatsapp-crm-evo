update public.whatsapp_contacts
set lid_jid = remote_jid
where remote_jid like '%@lid'
  and lid_jid is null;

update public.whatsapp_contacts
set push_name = null
where lid_jid is not null
  and push_name = split_part(lid_jid, '@', 1);

update public.whatsapp_contacts
set phone_number = null
where phone_number is not null
  and (
    phone_number !~ '^[0-9]{8,15}$'
    or phone_number ~ '^0+$'
  );

update public.whatsapp_contacts
set push_name = null
where remote_jid = '0@s.whatsapp.net'
  and push_name = '0';
