// lt_config_label_templates. Writes bump `revision`; the apply pass is a
// zero-row no-op when the declaration is unchanged.

const COLUMNS = `name, scheme_version, title, description, codes, text, symbology,
   human_readable, media, sensitive, enabled, source`;
const VALUES = '$1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12';
const SET = `scheme_version = EXCLUDED.scheme_version,
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  codes = EXCLUDED.codes,
  text = EXCLUDED.text,
  symbology = EXCLUDED.symbology,
  human_readable = EXCLUDED.human_readable,
  media = EXCLUDED.media,
  sensitive = EXCLUDED.sensitive,
  enabled = EXCLUDED.enabled,
  source = EXCLUDED.source,
  revision = lt_config_label_templates.revision + 1`;

export const LIST_TEMPLATES = 'SELECT * FROM lt_config_label_templates ORDER BY scheme_version, name';

export const LIST_TEMPLATES_BY_SCHEME =
  'SELECT * FROM lt_config_label_templates WHERE scheme_version = $1 ORDER BY name';

export const GET_TEMPLATE = 'SELECT * FROM lt_config_label_templates WHERE name = $1';

export const DELETE_TEMPLATE = 'DELETE FROM lt_config_label_templates WHERE name = $1';

/** API write. $13 is the expected revision; null writes unconditionally. */
export const UPSERT_TEMPLATE = `\
INSERT INTO lt_config_label_templates (${COLUMNS})
VALUES (${VALUES})
ON CONFLICT (name) DO UPDATE SET ${SET}
WHERE $13::int IS NULL OR lt_config_label_templates.revision = $13::int
RETURNING *`;

export const SEED_TEMPLATE = `\
INSERT INTO lt_config_label_templates (${COLUMNS})
VALUES (${VALUES})
ON CONFLICT (name) DO NOTHING`;

export const APPLY_TEMPLATE = `\
INSERT INTO lt_config_label_templates (${COLUMNS})
VALUES (${VALUES})
ON CONFLICT (name) DO UPDATE SET ${SET}
WHERE (lt_config_label_templates.scheme_version, lt_config_label_templates.title,
       lt_config_label_templates.description, lt_config_label_templates.codes,
       lt_config_label_templates.text, lt_config_label_templates.symbology,
       lt_config_label_templates.human_readable, lt_config_label_templates.media,
       lt_config_label_templates.sensitive, lt_config_label_templates.enabled,
       lt_config_label_templates.source)
  IS DISTINCT FROM
      (EXCLUDED.scheme_version, EXCLUDED.title, EXCLUDED.description, EXCLUDED.codes,
       EXCLUDED.text, EXCLUDED.symbology, EXCLUDED.human_readable, EXCLUDED.media,
       EXCLUDED.sensitive, EXCLUDED.enabled, EXCLUDED.source)
RETURNING (xmax = 0) AS inserted`;
