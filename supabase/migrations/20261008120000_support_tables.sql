create extension if not exists citext with schema public;
create extension if not exists vector with schema extensions;

create table customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email citext not null unique,
  created_at timestamptz not null default now()
);

create table products (
  sku text primary key,
  name text not null,
  inventory integer not null check (inventory >= 0),
  description text not null,
  tags text[] not null default '{}',
  embedding extensions.vector(384),
  updated_at timestamptz not null default now()
);

create table orders (
  id uuid primary key default gen_random_uuid(),
  order_number citext not null unique,
  customer_id uuid not null references customers (id),
  status text not null check (status in ('delivered', 'in-transit', 'fulfilled', 'error')),
  tracking_number text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table order_items (
  order_id uuid not null references orders (id),
  product_sku text not null,
  primary key (order_id, product_sku)
);

create table promotion_codes (
  id uuid primary key default gen_random_uuid(),
  email citext not null,
  campaign text not null,
  code text not null unique,
  discount_percent integer not null check (discount_percent >= 1 and discount_percent <= 100),
  issued_at timestamptz not null,
  expires_at timestamptz not null
);

create table support_handoffs (
  id uuid primary key default gen_random_uuid(),
  email citext not null,
  reason text not null,
  order_number citext,
  status text not null default 'open' check (status in ('open', 'closed', 'resolved')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table sessions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  source text not null,
  ended_at timestamptz,
  next_message_sequence bigint not null default 0,
  active_operation_id uuid,
  active_until timestamptz,
  unmatched_order_count integer not null default 0
);

create table messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions (id),
  sequence bigint not null check (sequence >= 0),
  role text not null check (
    role in ('user', 'assistant', 'summary', 'tool_trace', 'tool_call', 'tool_result')
  ),
  content text not null,
  tool_names text[],
  compacted boolean not null default false,
  created_at timestamptz not null default now(),
  turn_id uuid,
  turn_index integer
);

create table support_handoff_proposals (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions (id),
  turn_id uuid not null,
  email citext not null,
  reason text not null,
  order_number citext,
  decision text not null default 'pending' check (decision in ('pending', 'confirmed', 'cancelled')),
  case_id uuid references support_handoffs (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
