-- Remove portal copies and links for the deleted workspace. Shared mailbox data stays with its organisation.
begin;

alter table public.portal_mail_client_scopes
  drop constraint portal_mail_client_scopes_client_id_fkey,
  add constraint portal_mail_client_scopes_client_id_fkey
    foreign key (client_id) references public.portal_clients(id) on delete cascade;

alter table public.portal_mail_client_links
  drop constraint portal_mail_client_links_organisation_id_client_id_fkey,
  add constraint portal_mail_client_links_organisation_id_client_id_fkey
    foreign key (organisation_id, client_id)
    references public.portal_mail_client_scopes(organisation_id, client_id) on delete cascade;

alter table public.portal_mail_publications
  drop constraint portal_mail_publications_organisation_id_connection_id_pro_fkey,
  add constraint portal_mail_publications_client_link_fkey
    foreign key (organisation_id, connection_id, provider_thread_id, client_id)
    references public.portal_mail_client_links(organisation_id, connection_id, provider_thread_id, client_id)
    on delete cascade;

commit;
