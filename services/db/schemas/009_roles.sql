-- Make lt_roles the canonical role registry.
-- For existing DBs: create the table, backfill from all sources, add FK constraints.

CREATE TABLE IF NOT EXISTS lt_roles (
  role       TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed standard roles
INSERT INTO lt_roles (role) VALUES
  ('reviewer'),
  ('engineer'),
  ('admin'),
  ('superadmin')
ON CONFLICT DO NOTHING;

-- Backfill any roles that already exist in other tables
INSERT INTO lt_roles (role)
SELECT DISTINCT role FROM lt_user_roles
ON CONFLICT DO NOTHING;

INSERT INTO lt_roles (role)
SELECT DISTINCT source_role FROM lt_config_role_escalations
ON CONFLICT DO NOTHING;

INSERT INTO lt_roles (role)
SELECT DISTINCT target_role FROM lt_config_role_escalations
ON CONFLICT DO NOTHING;

INSERT INTO lt_roles (role)
SELECT DISTINCT role FROM lt_config_roles
ON CONFLICT DO NOTHING;

INSERT INTO lt_roles (role)
SELECT DISTINCT role FROM lt_config_invocation_roles
ON CONFLICT DO NOTHING;

INSERT INTO lt_roles (role)
SELECT DISTINCT default_role FROM lt_config_workflows
ON CONFLICT DO NOTHING;

INSERT INTO lt_roles (role)
SELECT DISTINCT role FROM lt_escalations
ON CONFLICT DO NOTHING;

-- Add FK constraints to all tables that reference roles
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_lt_user_roles_role' AND table_name = 'lt_user_roles'
  ) THEN
    ALTER TABLE lt_user_roles
      ADD CONSTRAINT fk_lt_user_roles_role FOREIGN KEY (role) REFERENCES lt_roles(role);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_lt_escalations_role' AND table_name = 'lt_escalations'
  ) THEN
    ALTER TABLE lt_escalations
      ADD CONSTRAINT fk_lt_escalations_role FOREIGN KEY (role) REFERENCES lt_roles(role);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_lt_config_workflows_default_role' AND table_name = 'lt_config_workflows'
  ) THEN
    ALTER TABLE lt_config_workflows
      ADD CONSTRAINT fk_lt_config_workflows_default_role FOREIGN KEY (default_role) REFERENCES lt_roles(role);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_lt_config_roles_role' AND table_name = 'lt_config_roles'
  ) THEN
    ALTER TABLE lt_config_roles
      ADD CONSTRAINT fk_lt_config_roles_role FOREIGN KEY (role) REFERENCES lt_roles(role);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_lt_config_invocation_roles_role' AND table_name = 'lt_config_invocation_roles'
  ) THEN
    ALTER TABLE lt_config_invocation_roles
      ADD CONSTRAINT fk_lt_config_invocation_roles_role FOREIGN KEY (role) REFERENCES lt_roles(role);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_lt_config_role_escalations_source' AND table_name = 'lt_config_role_escalations'
  ) THEN
    ALTER TABLE lt_config_role_escalations
      ADD CONSTRAINT fk_lt_config_role_escalations_source FOREIGN KEY (source_role) REFERENCES lt_roles(role);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_lt_config_role_escalations_target' AND table_name = 'lt_config_role_escalations'
  ) THEN
    ALTER TABLE lt_config_role_escalations
      ADD CONSTRAINT fk_lt_config_role_escalations_target FOREIGN KEY (target_role) REFERENCES lt_roles(role);
  END IF;
END $$;
