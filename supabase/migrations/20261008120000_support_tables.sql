create table sessions (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  timezone text not null default '',
  next_message_sequence bigint not null default 1,
  unmatched_order_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ended_at timestamptz,
  constraint sessions_source_present check (length(btrim(source)) >= 1),
  constraint sessions_unmatched_order_count_range check (
    unmatched_order_count between 0 and 2
  ),
  constraint sessions_next_message_sequence_positive check (
    next_message_sequence >= 1
  )
);

create table messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions (id) on delete cascade,
  sequence bigint not null,
  role text not null,
  content text not null,
  tool_names text[],
  compacted boolean not null default false,
  created_at timestamptz not null default now(),
  turn_id uuid,
  turn_index integer not null,
  constraint messages_session_sequence_key unique (session_id, sequence),
  constraint messages_sequence_positive check (sequence >= 1),
  constraint messages_role_present check (length(btrim(role)) >= 1)
);

create unique index messages_session_id_turn_id_role_key
  on messages (session_id, turn_id, role)
  where turn_id is not null;

create table support_handoffs (
  id uuid primary key,
  contact_email text not null,
  reason text not null,
  order_number text,
  status text not null default 'open',
  constraint support_handoffs_status_check check (
    status in ('open', 'closed', 'resolved')
  ),
  constraint support_handoffs_contact_email_lower check (
    contact_email = lower(contact_email)
    and length(btrim(contact_email)) >= 1
  ),
  constraint support_handoffs_reason_present check (length(btrim(reason)) >= 1),
  constraint support_handoffs_order_number_shape check (
    order_number is null or order_number ~ '^#.+'
  )
);

create table support_handoff_proposals (
  id uuid primary key,
  session_id uuid not null references sessions (id) on delete cascade,
  turn_id uuid not null,
  contact_email text not null,
  reason text not null,
  order_number text,
  decision text not null default 'pending',
  case_id uuid references support_handoffs (id),
  constraint support_handoff_proposals_session_turn_key unique (session_id, turn_id),
  constraint support_handoff_proposals_decision_check check (
    decision in ('pending', 'confirmed', 'cancelled')
  ),
  constraint support_handoff_proposals_case_when_confirmed check (
    (
      decision = 'confirmed'
      and case_id is not null
      and case_id = id
    )
    or (
      decision in ('pending', 'cancelled')
      and case_id is null
    )
  ),
  constraint support_handoff_proposals_contact_email_lower check (
    contact_email = lower(contact_email)
    and length(btrim(contact_email)) >= 1
  ),
  constraint support_handoff_proposals_reason_present check (
    length(btrim(reason)) >= 1
  ),
  constraint support_handoff_proposals_order_number_shape check (
    order_number is null or order_number ~ '^#.+'
  )
);

alter table sessions enable row level security;
alter table messages enable row level security;
alter table support_handoffs enable row level security;
alter table support_handoff_proposals enable row level security;
