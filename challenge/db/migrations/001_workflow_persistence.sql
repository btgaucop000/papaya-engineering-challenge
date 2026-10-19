DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'claims_runtime') THEN
    CREATE ROLE claims_runtime LOGIN PASSWORD 'claims_runtime';
  ELSE
    ALTER ROLE claims_runtime WITH LOGIN PASSWORD 'claims_runtime';
  END IF;
END
$migration$;

CREATE TABLE IF NOT EXISTS claims (
  id uuid PRIMARY KEY,
  state text NOT NULL,
  amount bigint NOT NULL CHECK (amount >= 0),
  policy_limit bigint NOT NULL CHECK (policy_limit >= 0),
  required_documents jsonb NOT NULL DEFAULT '[]'::jsonb,
  assessor_id text,
  assessment_report jsonb,
  assessment_report_complete boolean NOT NULL DEFAULT false,
  assessment_started_at timestamptz,
  information_request_count integer NOT NULL DEFAULT 0 CHECK (information_request_count >= 0),
  current_information_request_sequence integer,
  current_information_request_description text,
  rejection_reason text,
  appeal_expires_at timestamptz,
  member_acknowledged_rejection boolean NOT NULL DEFAULT false,
  archived_at timestamptz,
  audit_sequence integer NOT NULL DEFAULT 0 CHECK (audit_sequence >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS additional_information (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  claim_id uuid NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  request_sequence integer NOT NULL CHECK (request_sequence > 0),
  is_valid boolean NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS additional_information_claim_sequence_idx
  ON additional_information (claim_id, request_sequence);

CREATE TABLE IF NOT EXISTS payment_requests (
  id uuid PRIMARY KEY,
  claim_id uuid NOT NULL UNIQUE REFERENCES claims(id) ON DELETE CASCADE,
  amount bigint NOT NULL CHECK (amount >= 0),
  status text NOT NULL CHECK (status IN ('REQUESTED', 'INITIATED')),
  confirmed boolean NOT NULL DEFAULT false,
  payment_reference text,
  created_at timestamptz NOT NULL,
  initiated_at timestamptz,
  confirmed_at timestamptz
);

CREATE TABLE IF NOT EXISTS claim_audit (
  claim_id uuid NOT NULL REFERENCES claims(id) ON DELETE RESTRICT,
  sequence integer NOT NULL CHECK (sequence > 0),
  occurred_at timestamptz NOT NULL,
  from_state text NOT NULL,
  to_state text NOT NULL,
  transition_id text NOT NULL,
  triggered_by_user_id varchar(100) NOT NULL,
  triggered_by_role text NOT NULL,
  reason text,
  PRIMARY KEY (claim_id, sequence)
);

CREATE OR REPLACE FUNCTION prevent_claim_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  RAISE EXCEPTION 'claim_audit rows are immutable'
    USING ERRCODE = '55000';
END
$function$;

DROP TRIGGER IF EXISTS claim_audit_immutable ON claim_audit;
CREATE TRIGGER claim_audit_immutable
BEFORE UPDATE OR DELETE ON claim_audit
FOR EACH ROW EXECUTE FUNCTION prevent_claim_audit_mutation();

REVOKE ALL ON TABLE claim_audit FROM PUBLIC, claims_runtime;
GRANT SELECT, INSERT ON TABLE claim_audit TO claims_runtime;

GRANT USAGE ON SCHEMA public TO claims_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE claims TO claims_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE additional_information TO claims_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE payment_requests TO claims_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO claims_runtime;
