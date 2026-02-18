-- OrderPulse Database Schema
-- PostgreSQL

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  google_id VARCHAR(255) UNIQUE NOT NULL,
  email VARCHAR(255) NOT NULL,
  name VARCHAR(255),
  picture_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- OAuth tokens (encrypted at rest)
CREATE TABLE IF NOT EXISTS oauth_tokens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  access_token_encrypted TEXT NOT NULL,
  refresh_token_encrypted TEXT NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id)
);

-- Extracted orders
CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  original_email_id VARCHAR(255),
  supplier VARCHAR(255),
  order_date DATE,
  total_amount DECIMAL(10,2),
  confidence DECIMAL(3,2),
  raw_data JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Order line items
CREATE TABLE IF NOT EXISTS order_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  quantity INTEGER NOT NULL,
  unit VARCHAR(50),
  unit_price DECIMAL(10,2),
  total_price DECIMAL(10,2)
);

-- Indices for query performance
CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_date ON orders(order_date);
CREATE INDEX IF NOT EXISTS idx_orders_supplier ON orders(supplier);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_tokens_user_id ON oauth_tokens(user_id);

-- Inbound forwarded receipt ingestion
CREATE TABLE IF NOT EXISTS inbound_receipts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider VARCHAR(50) NOT NULL DEFAULT 'postmark',
  provider_message_id TEXT,
  message_id TEXT,
  idempotency_key TEXT NOT NULL,
  from_email VARCHAR(320) NOT NULL,
  from_name TEXT,
  subject TEXT,
  source_recipient VARCHAR(320),
  email_date TIMESTAMP WITH TIME ZONE,
  raw_headers JSONB,
  raw_text_body TEXT,
  raw_html_body TEXT,
  content_hash TEXT NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'processing', 'retry', 'quarantined', 'synced', 'failed')),
  guardrail_reason TEXT,
  resolved_user_email VARCHAR(320),
  resolved_author TEXT,
  resolved_tenant_id TEXT,
  extracted_data JSONB,
  arda_order_record_id TEXT,
  arda_item_record_ids JSONB,
  duplicate_of_event_id UUID REFERENCES inbound_receipts(id),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  last_error TEXT,
  processed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS inbound_receipt_attempts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  receipt_id UUID NOT NULL REFERENCES inbound_receipts(id) ON DELETE CASCADE,
  attempt_number INTEGER NOT NULL,
  status VARCHAR(32) NOT NULL CHECK (status IN ('processing', 'retry', 'quarantined', 'synced', 'failed')),
  error TEXT,
  metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_inbound_receipts_idempotency_key ON inbound_receipts(idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS idx_inbound_receipts_provider_message ON inbound_receipts(provider, provider_message_id) WHERE provider_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inbound_receipts_status_next_attempt ON inbound_receipts(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_inbound_receipts_created_at ON inbound_receipts(created_at);
CREATE INDEX IF NOT EXISTS idx_inbound_receipts_resolved_message ON inbound_receipts(resolved_user_email, message_id) WHERE message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inbound_receipts_resolved_hash ON inbound_receipts(resolved_user_email, content_hash);
CREATE INDEX IF NOT EXISTS idx_inbound_receipt_attempts_receipt_id ON inbound_receipt_attempts(receipt_id);

-- Accounting provider integrations (QuickBooks / Xero)
CREATE TABLE IF NOT EXISTS provider_connections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id TEXT NOT NULL,
  provider VARCHAR(32) NOT NULL CHECK (provider IN ('quickbooks', 'xero')),
  tenant_id TEXT NOT NULL,
  tenant_name TEXT,
  access_token_encrypted TEXT NOT NULL,
  refresh_token_encrypted TEXT NOT NULL,
  token_expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  scope TEXT,
  status VARCHAR(32) NOT NULL DEFAULT 'connected' CHECK (status IN ('connected', 'reauth_required', 'error', 'disconnected')),
  metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, provider)
);

CREATE TABLE IF NOT EXISTS provider_sync_state (
  connection_id UUID PRIMARY KEY REFERENCES provider_connections(id) ON DELETE CASCADE,
  backfill_started_at TIMESTAMP WITH TIME ZONE,
  backfill_completed_at TIMESTAMP WITH TIME ZONE,
  last_cursor_utc TIMESTAMP WITH TIME ZONE,
  cursor_payload JSONB,
  last_successful_sync_at TIMESTAMP WITH TIME ZONE,
  last_error TEXT,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS provider_sync_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  connection_id UUID NOT NULL REFERENCES provider_connections(id) ON DELETE CASCADE,
  "trigger" VARCHAR(32) NOT NULL CHECK ("trigger" IN ('manual', 'scheduled', 'webhook', 'backfill')),
  status VARCHAR(32) NOT NULL CHECK (status IN ('running', 'success', 'failed')),
  orders_upserted INTEGER NOT NULL DEFAULT 0,
  orders_deleted INTEGER NOT NULL DEFAULT 0,
  items_upserted INTEGER NOT NULL DEFAULT 0,
  api_calls INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMP WITH TIME ZONE,
  error TEXT
);

-- Backward compatibility for older installs that used run_trigger.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'provider_sync_runs'
      AND column_name = 'run_trigger'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'provider_sync_runs'
      AND column_name = 'trigger'
  ) THEN
    ALTER TABLE provider_sync_runs RENAME COLUMN run_trigger TO "trigger";
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS provider_webhook_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider VARCHAR(32) NOT NULL CHECK (provider IN ('quickbooks', 'xero')),
  provider_event_id TEXT NOT NULL,
  connection_id UUID REFERENCES provider_connections(id) ON DELETE SET NULL,
  signature_valid BOOLEAN NOT NULL DEFAULT false,
  payload JSONB NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'processed', 'ignored', 'failed')),
  received_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMP WITH TIME ZONE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_connections_user_provider ON provider_connections(user_id, provider);
CREATE INDEX IF NOT EXISTS idx_provider_connections_provider_tenant ON provider_connections(provider, tenant_id);
CREATE INDEX IF NOT EXISTS idx_provider_sync_runs_connection_started ON provider_sync_runs(connection_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_provider_sync_runs_status ON provider_sync_runs(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_webhook_event_unique ON provider_webhook_events(provider, provider_event_id);
CREATE INDEX IF NOT EXISTS idx_provider_webhook_connection_status ON provider_webhook_events(connection_id, status);

-- Updated at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply trigger to users
DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Apply trigger to oauth_tokens
DROP TRIGGER IF EXISTS update_oauth_tokens_updated_at ON oauth_tokens;
CREATE TRIGGER update_oauth_tokens_updated_at
  BEFORE UPDATE ON oauth_tokens
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Apply trigger to inbound_receipts
DROP TRIGGER IF EXISTS update_inbound_receipts_updated_at ON inbound_receipts;
CREATE TRIGGER update_inbound_receipts_updated_at
  BEFORE UPDATE ON inbound_receipts
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Apply trigger to provider_connections
DROP TRIGGER IF EXISTS update_provider_connections_updated_at ON provider_connections;
CREATE TRIGGER update_provider_connections_updated_at
  BEFORE UPDATE ON provider_connections
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Apply trigger to provider_sync_state
DROP TRIGGER IF EXISTS update_provider_sync_state_updated_at ON provider_sync_state;
CREATE TRIGGER update_provider_sync_state_updated_at
  BEFORE UPDATE ON provider_sync_state
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
