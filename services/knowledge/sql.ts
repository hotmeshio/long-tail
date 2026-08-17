export const GET_KNOWLEDGE_VERSION = `
  SELECT domain, key, version, data, tags, change_summary, created_at
  FROM lt_knowledge_versions
  WHERE domain = $1 AND key = $2 AND version = $3`;

export const LIST_KNOWLEDGE_VERSIONS = `
  SELECT v.version, v.change_summary, v.created_at,
         (v.version = k.current_version) AS is_current
  FROM lt_knowledge_versions v
  JOIN lt_knowledge k ON k.domain = v.domain AND k.key = v.key
  WHERE v.domain = $1 AND v.key = $2
  ORDER BY v.version DESC`;
