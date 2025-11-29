/*
  # M4 Track - Analytics Comportamental Platform Schema

  ## Overview
  Complete multi-tenant SaaS platform for behavioral analytics on landing pages.
  
  ## Tables Created
  
  ### 1. companies
  Stores company/tenant information with isolated data access
  - `id` (uuid, primary key) - Unique company identifier
  - `name` (text) - Company name
  - `domain` (text) - Company domain for validation
  - `api_key` (uuid) - Unique API key for tracking script
  - `webhook_url` (text, nullable) - URL to send conversion webhooks
  - `webhook_secret` (text, nullable) - Secret for webhook validation
  - `plan` (text) - Subscription plan (basic, pro, enterprise)
  - `status` (text) - Account status (active, suspended, cancelled)
  - `user_id` (uuid) - Reference to auth.users
  - `created_at` (timestamptz) - Creation timestamp
  - `updated_at` (timestamptz) - Last update timestamp

  ### 2. landing_pages
  Stores landing pages registered for tracking
  - `id` (uuid, primary key) - Unique page identifier
  - `company_id` (uuid, foreign key) - Reference to companies
  - `name` (text) - Friendly name for the page
  - `url` (text) - Full URL of the landing page
  - `tracking_code` (uuid) - Unique tracking code for this page
  - `status` (text) - Page status (active, paused, archived)
  - `created_at` (timestamptz) - Creation timestamp
  - `updated_at` (timestamptz) - Last update timestamp

  ### 3. visitors
  Stores visitor session data
  - `id` (uuid, primary key) - Unique visitor session identifier
  - `landing_page_id` (uuid, foreign key) - Reference to landing_pages
  - `session_id` (uuid) - Browser session identifier
  - `ip_address` (inet, nullable) - Visitor IP address
  - `user_agent` (text) - Browser user agent
  - `device_type` (text) - Device type (desktop, mobile, tablet)
  - `screen_resolution` (text) - Screen resolution
  - `referrer` (text, nullable) - Referrer URL
  - `created_at` (timestamptz) - First visit timestamp

  ### 4. behavior_events
  Stores all behavioral events (clicks, scrolls, interactions)
  - `id` (uuid, primary key) - Unique event identifier
  - `visitor_id` (uuid, foreign key) - Reference to visitors
  - `event_type` (text) - Type of event (click, scroll, hover, form_interaction)
  - `event_data` (jsonb) - Detailed event data
  - `coordinates` (jsonb, nullable) - X/Y coordinates for spatial events
  - `element_selector` (text, nullable) - CSS selector of element
  - `section` (text, nullable) - Page section identifier
  - `timestamp` (timestamptz) - Event timestamp

  ### 5. conversions
  Stores conversion data with behavioral summary
  - `id` (uuid, primary key) - Unique conversion identifier
  - `visitor_id` (uuid, foreign key) - Reference to visitors
  - `landing_page_id` (uuid, foreign key) - Reference to landing_pages
  - `form_data` (jsonb) - Submitted form data
  - `behavior_summary` (jsonb) - Aggregated behavioral metrics
  - `engagement_score` (numeric) - Calculated engagement score
  - `time_to_convert` (integer) - Seconds from first visit to conversion
  - `webhook_sent` (boolean) - Whether webhook was sent
  - `webhook_response` (jsonb, nullable) - Webhook response data
  - `converted_at` (timestamptz) - Conversion timestamp

  ### 6. webhook_logs
  Stores webhook delivery logs for debugging
  - `id` (uuid, primary key) - Unique log identifier
  - `company_id` (uuid, foreign key) - Reference to companies
  - `conversion_id` (uuid, foreign key) - Reference to conversions
  - `webhook_url` (text) - Target webhook URL
  - `payload` (jsonb) - Sent payload
  - `response_status` (integer, nullable) - HTTP response status
  - `response_body` (text, nullable) - Response body
  - `error_message` (text, nullable) - Error message if failed
  - `sent_at` (timestamptz) - Send timestamp

  ### 7. analytics_cache
  Stores pre-calculated analytics for performance
  - `id` (uuid, primary key) - Unique cache identifier
  - `landing_page_id` (uuid, foreign key) - Reference to landing_pages
  - `date` (date) - Date of analytics
  - `metrics` (jsonb) - Cached metrics data
  - `created_at` (timestamptz) - Cache creation timestamp

  ## Security
  - Row Level Security (RLS) enabled on all tables
  - Companies can only access their own data
  - Tracking endpoints use API key validation
  - Webhook secrets for secure integrations

  ## Indexes
  - Optimized indexes for common queries
  - Composite indexes for multi-column filters
  - GIN indexes for JSONB columns

  ## Important Notes
  1. All tables use UUID for primary keys
  2. Timestamps use timestamptz for timezone awareness
  3. JSONB used for flexible schema in event_data
  4. Foreign keys ensure referential integrity
  5. Default values set for critical fields
*/

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Companies table
CREATE TABLE IF NOT EXISTS companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  domain text,
  api_key uuid UNIQUE NOT NULL DEFAULT gen_random_uuid(),
  webhook_url text,
  webhook_secret text,
  plan text NOT NULL DEFAULT 'basic' CHECK (plan IN ('basic', 'pro', 'enterprise')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'cancelled')),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Landing Pages table
CREATE TABLE IF NOT EXISTS landing_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES companies(id) ON DELETE CASCADE NOT NULL,
  name text NOT NULL,
  url text NOT NULL,
  tracking_code uuid UNIQUE NOT NULL DEFAULT gen_random_uuid(),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'archived')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Visitors table
CREATE TABLE IF NOT EXISTS visitors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  landing_page_id uuid REFERENCES landing_pages(id) ON DELETE CASCADE NOT NULL,
  session_id uuid NOT NULL,
  ip_address inet,
  user_agent text,
  device_type text CHECK (device_type IN ('desktop', 'mobile', 'tablet')),
  screen_resolution text,
  referrer text,
  created_at timestamptz DEFAULT now()
);

-- Behavior Events table
CREATE TABLE IF NOT EXISTS behavior_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visitor_id uuid REFERENCES visitors(id) ON DELETE CASCADE NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('click', 'scroll', 'hover', 'form_interaction', 'page_view', 'section_view')),
  event_data jsonb NOT NULL DEFAULT '{}',
  coordinates jsonb,
  element_selector text,
  section text,
  timestamp timestamptz DEFAULT now()
);

-- Conversions table
CREATE TABLE IF NOT EXISTS conversions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visitor_id uuid REFERENCES visitors(id) ON DELETE CASCADE NOT NULL,
  landing_page_id uuid REFERENCES landing_pages(id) ON DELETE CASCADE NOT NULL,
  form_data jsonb NOT NULL DEFAULT '{}',
  behavior_summary jsonb NOT NULL DEFAULT '{}',
  engagement_score numeric(4,2) DEFAULT 0,
  time_to_convert integer DEFAULT 0,
  webhook_sent boolean DEFAULT false,
  webhook_response jsonb,
  converted_at timestamptz DEFAULT now()
);

-- Webhook Logs table
CREATE TABLE IF NOT EXISTS webhook_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES companies(id) ON DELETE CASCADE NOT NULL,
  conversion_id uuid REFERENCES conversions(id) ON DELETE CASCADE,
  webhook_url text NOT NULL,
  payload jsonb NOT NULL,
  response_status integer,
  response_body text,
  error_message text,
  sent_at timestamptz DEFAULT now()
);

-- Analytics Cache table
CREATE TABLE IF NOT EXISTS analytics_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  landing_page_id uuid REFERENCES landing_pages(id) ON DELETE CASCADE NOT NULL,
  date date NOT NULL,
  metrics jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  UNIQUE(landing_page_id, date)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_landing_pages_company ON landing_pages(company_id);
CREATE INDEX IF NOT EXISTS idx_landing_pages_tracking_code ON landing_pages(tracking_code);
CREATE INDEX IF NOT EXISTS idx_visitors_landing_page ON visitors(landing_page_id);
CREATE INDEX IF NOT EXISTS idx_visitors_session ON visitors(session_id);
CREATE INDEX IF NOT EXISTS idx_behavior_events_visitor ON behavior_events(visitor_id);
CREATE INDEX IF NOT EXISTS idx_behavior_events_timestamp ON behavior_events(timestamp);
CREATE INDEX IF NOT EXISTS idx_behavior_events_type ON behavior_events(event_type);
CREATE INDEX IF NOT EXISTS idx_conversions_visitor ON conversions(visitor_id);
CREATE INDEX IF NOT EXISTS idx_conversions_landing_page ON conversions(landing_page_id);
CREATE INDEX IF NOT EXISTS idx_conversions_converted_at ON conversions(converted_at);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_company ON webhook_logs(company_id);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_conversion ON webhook_logs(conversion_id);
CREATE INDEX IF NOT EXISTS idx_analytics_cache_page_date ON analytics_cache(landing_page_id, date);

-- GIN indexes for JSONB columns
CREATE INDEX IF NOT EXISTS idx_behavior_events_data ON behavior_events USING GIN(event_data);
CREATE INDEX IF NOT EXISTS idx_conversions_behavior_summary ON conversions USING GIN(behavior_summary);

-- Enable Row Level Security
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE landing_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE visitors ENABLE ROW LEVEL SECURITY;
ALTER TABLE behavior_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversions ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_cache ENABLE ROW LEVEL SECURITY;

-- RLS Policies for companies
CREATE POLICY "Users can view own company"
  ON companies FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own company"
  ON companies FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can insert own company"
  ON companies FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- RLS Policies for landing_pages
CREATE POLICY "Users can view own landing pages"
  ON landing_pages FOR SELECT
  TO authenticated
  USING (
    company_id IN (
      SELECT id FROM companies WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert own landing pages"
  ON landing_pages FOR INSERT
  TO authenticated
  WITH CHECK (
    company_id IN (
      SELECT id FROM companies WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update own landing pages"
  ON landing_pages FOR UPDATE
  TO authenticated
  USING (
    company_id IN (
      SELECT id FROM companies WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    company_id IN (
      SELECT id FROM companies WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete own landing pages"
  ON landing_pages FOR DELETE
  TO authenticated
  USING (
    company_id IN (
      SELECT id FROM companies WHERE user_id = auth.uid()
    )
  );

-- RLS Policies for visitors (read-only through landing pages)
CREATE POLICY "Users can view visitors of own landing pages"
  ON visitors FOR SELECT
  TO authenticated
  USING (
    landing_page_id IN (
      SELECT lp.id FROM landing_pages lp
      JOIN companies c ON lp.company_id = c.id
      WHERE c.user_id = auth.uid()
    )
  );

-- RLS Policies for behavior_events
CREATE POLICY "Users can view behavior events of own visitors"
  ON behavior_events FOR SELECT
  TO authenticated
  USING (
    visitor_id IN (
      SELECT v.id FROM visitors v
      JOIN landing_pages lp ON v.landing_page_id = lp.id
      JOIN companies c ON lp.company_id = c.id
      WHERE c.user_id = auth.uid()
    )
  );

-- RLS Policies for conversions
CREATE POLICY "Users can view own conversions"
  ON conversions FOR SELECT
  TO authenticated
  USING (
    landing_page_id IN (
      SELECT lp.id FROM landing_pages lp
      JOIN companies c ON lp.company_id = c.id
      WHERE c.user_id = auth.uid()
    )
  );

-- RLS Policies for webhook_logs
CREATE POLICY "Users can view own webhook logs"
  ON webhook_logs FOR SELECT
  TO authenticated
  USING (
    company_id IN (
      SELECT id FROM companies WHERE user_id = auth.uid()
    )
  );

-- RLS Policies for analytics_cache
CREATE POLICY "Users can view own analytics cache"
  ON analytics_cache FOR SELECT
  TO authenticated
  USING (
    landing_page_id IN (
      SELECT lp.id FROM landing_pages lp
      JOIN companies c ON lp.company_id = c.id
      WHERE c.user_id = auth.uid()
    )
  );

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers for updated_at
CREATE TRIGGER update_companies_updated_at BEFORE UPDATE ON companies
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_landing_pages_updated_at BEFORE UPDATE ON landing_pages
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();