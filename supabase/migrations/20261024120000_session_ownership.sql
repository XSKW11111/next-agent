alter table sessions add column owner_hash text;

alter table sessions add constraint sessions_owner_hash_format
  check (owner_hash is null or owner_hash ~ '^[0-9a-f]{64}$');
