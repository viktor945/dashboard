-- Run once in Supabase SQL Editor. Does not change dashboards or Auth internals.
begin;
create table if not exists public.device_links (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references auth.users(id) on delete cascade,
 offer_hash text not null check (offer_hash ~ '^[a-f0-9]{64}$'),
 device_hash text check (device_hash ~ '^[a-f0-9]{64}$'),
 verification_code text not null check (verification_code ~ '^[0-9]{6}$'),
 workspace text not null check (workspace in ('work','personal')),
 state text not null default 'pending' check (state in ('pending','scanned','approving','approved','redeemed','revoked')),
 otp_hash text,
 created_at timestamptz not null default now(),
 expires_at timestamptz not null default now() + interval '5 minutes'
);
create index if not exists device_links_expiry on public.device_links(expires_at);
create index if not exists device_links_owner on public.device_links(owner_id,created_at);
create unique index if not exists device_links_one_active on public.device_links(owner_id)
 where state in ('pending','scanned','approving','approved');
alter table public.device_links enable row level security;
alter table public.device_links force row level security;
revoke all on public.device_links from public,anon,authenticated;
grant select,insert,update,delete on public.device_links to service_role;

create or replace function public.device_link_create(p_owner uuid,p_offer_hash text,p_code text,p_workspace text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.device_links;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text,0));
 delete from public.device_links where expires_at < now()-interval '1 day';
 if (select count(*) from public.device_links where owner_id=p_owner and created_at>now()-interval '1 minute')>=5 then
  return jsonb_build_object('state','rate_limited');
 end if;
 update public.device_links set state='revoked',otp_hash=null where owner_id=p_owner and state in ('pending','scanned','approving','approved');
 insert into public.device_links(owner_id,offer_hash,verification_code,workspace)
 values(p_owner,p_offer_hash,p_code,p_workspace) returning * into r;
 return jsonb_build_object('id',r.id,'state',r.state,'expires_at',r.expires_at);
end;$$;

create or replace function public.device_link_transition(
 p_action text,p_id uuid,p_owner uuid default null,p_offer_hash text default null,p_device_hash text default null,p_otp_hash text default null
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.device_links; secret text;
begin
 select * into r from public.device_links where id=p_id for update;
 if not found then return jsonb_build_object('state','invalid');end if;
 if p_action in ('status','reserve','approve','release','cancel') then
  if p_owner is null or r.owner_id<>p_owner then return jsonb_build_object('state','invalid');end if;
 elsif p_action in ('claim','consume') then
  if p_offer_hash is null or p_device_hash is null or r.offer_hash<>p_offer_hash then return jsonb_build_object('state','invalid');end if;
  if r.device_hash is not null and r.device_hash<>p_device_hash then return jsonb_build_object('state','other_device');end if;
 else return jsonb_build_object('state','invalid');end if;
 if p_action='cancel' then
  update public.device_links set state='revoked',otp_hash=null where id=r.id;
  return jsonb_build_object('state','revoked');
 end if;
 if r.expires_at<=clock_timestamp() then
  update public.device_links set state='revoked',otp_hash=null where id=r.id;
  return jsonb_build_object('state','expired');
 end if;
 if r.state in ('redeemed','revoked') then return jsonb_build_object('state',r.state);end if;
 if p_action='claim' and r.state='pending' then
  update public.device_links set state='scanned',device_hash=p_device_hash where id=r.id;
  r.state:='scanned';
 elsif p_action='reserve' then
  if r.state<>'scanned' then return jsonb_build_object('state','not_ready');end if;
  update public.device_links set state='approving' where id=r.id;
  r.state:='approving';
 elsif p_action='approve' then
  if r.state<>'approving' or p_otp_hash is null or length(p_otp_hash)<20 then return jsonb_build_object('state','not_ready');end if;
  update public.device_links set state='approved',otp_hash=p_otp_hash where id=r.id;
  r.state:='approved';
 elsif p_action='release' and r.state='approving' then
  update public.device_links set state='scanned',otp_hash=null where id=r.id;
  r.state:='scanned';
 elsif p_action='consume' and r.state='approved' then
  if r.device_hash is null or r.device_hash<>p_device_hash then return jsonb_build_object('state','invalid');end if;
  secret:=r.otp_hash;
  update public.device_links set state='redeemed',otp_hash=null where id=r.id;
  return jsonb_build_object('state','redeemed','token_hash',secret,'owner_id',r.owner_id,'workspace',r.workspace);
 end if;
 return jsonb_build_object('state',r.state,'code',case when r.state<>'pending' then r.verification_code else null end,'expires_at',r.expires_at);
end;$$;
revoke all on function public.device_link_create(uuid,text,text,text) from public,anon,authenticated;
revoke all on function public.device_link_transition(text,uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.device_link_create(uuid,text,text,text) to service_role;
grant execute on function public.device_link_transition(text,uuid,uuid,text,text,text) to service_role;
commit;
