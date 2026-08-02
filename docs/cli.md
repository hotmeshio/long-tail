# CLI

`ltc` is the command-line interface for Long Tail. It provides terminal access to the same capabilities as the dashboard and SDK — escalations, workflows, knowledge, MCP servers, and the durable-to-YAML compiler.

## Install

```bash
npm install -g @hotmeshio/long-tail
```

Or run without installing:

```bash
npx @hotmeshio/long-tail ltc --help
```

## Connect

### Interactive login

```bash
ltc login
```

Prompts for server URL, username, and password. Stores credentials in `~/.config/longtail/credentials.json` (file permissions `0600`).

### Non-interactive (CI / scripts)

```bash
ltc login --server http://localhost:3000 --username superadmin --password 'l0ngt@1l'
```

### Environment variables

```bash
export LT_SERVER=http://localhost:3000
export LT_TOKEN=eyJ...
```

Environment variables take precedence over stored credentials.

### Token lifecycle

- JWT expires in 24 hours
- The CLI checks expiry before each call and auto-refreshes using stored credentials
- `ltc logout` clears stored credentials

---

## Commands

### Status

```bash
ltc status
```

Shows pending escalations, active workers, pipeline tools, and event transport.

### Escalations

```bash
ltc esc list                              # All escalations
ltc esc list --status pending             # Pending only
ltc esc list --role reviewer --limit 10   # Filter by role
ltc esc list --search wf-abc123           # Exact-match by escalation / workflow / origin id
ltc esc find-by-meta orderId ORD-42       # Match a value inside metadata (any status)
ltc esc get abc123                        # Detail view
ltc esc claim abc123                      # Claim for yourself
ltc esc claim abc123 --duration 60        # Claim for 60 minutes
ltc esc release abc123                    # Release back to pool
ltc esc resolve abc123 --data '{"approved": true}'   # Resolve with payload

# Metadata candidate key operations
ltc esc find-by-meta orderId order-123              # Find by metadata key
ltc esc find-by-meta orderId order-123 --status pending
ltc esc claim-by-meta orderId order-123             # Claim by metadata key
ltc esc claim-by-meta orderId order-123 --assignee ext-user-42  # On behalf of user
ltc esc resolve-by-meta orderId order-123 --data '{"approved": true}'
ltc esc resolve-by-meta orderId order-123 --data '{"approved": true}' --assignee ext-user-42

# Analytics: grouped membership/dwell aggregates and per-entity timelines
# The fleet: how the entities spent the window, one row per state
ltc esc aggregate-facets --entity serialNumber --group-state \
  --window '{"from":"2026-08-01T00:00:00Z","to":"2026-08-02T00:00:00Z"}'
# The individual: one printer's ordered interval timeline
ltc esc timeline serialNumber PRN-001 --entity serialNumber
```

`aggregate-facets` runs grouped analytics over the escalation intervals — membership at an instant (`--as-of`, default now), or dwell over a window (`--window` switches the measure). Scope with `--role`, `--roles`, or `--entity <key>` (the entity facet key — scopes to every role declaring it, the entity's system; no role at all spans every pond, global principals only). Group with `--group-columns role,subtype,status`, `--group-facets <list>`, or `--group-state` (the derived state label — each role's subtypes or itself). Refine with `--facets`/`--exists`, `--distinct-by <key>` (count entities, not rows; membership only), `--live-statuses`, and page the result groups with `--order-by`/`--limit`/`--offset`.

`timeline <key> <value>` prints one entity's ordered escalation-interval timeline (gaps = untracked time). `--entity` scopes to the entity's system (every role declaring that entity facet); `--roles` restricts to specific roles; a call with neither spans every pond and requires a global principal. `--from`/`--to` keep only overlapping intervals; `--select-facets` surfaces metadata keys per interval.

### Workflows

```bash
ltc wf list                               # Discovered workflows
ltc wf invoke reviewContent --data '{"content": "test"}'
ltc wf status wf-abc123                   # Check status (running/completed)
ltc wf result wf-abc123                   # Get result payload
ltc wf terminate wf-abc123                # Terminate a running workflow
```

### Pipeline Tools (YAML Workflows)

```bash
ltc pip list                              # All pipeline tools
ltc pip list --status active              # Active only
ltc pip get abc123                        # Detail view
ltc pip deploy abc123                     # Deploy a draft
ltc pip invoke abc123 --data '{"url": "https://example.com"}' --sync
ltc pip archive abc123                    # Archive
```

### Knowledge Store

```bash
ltc kb domains                            # List domains
ltc kb list research                      # List entries in domain
ltc kb list research --search google      # Search by key or tag
ltc kb get research google                # Full entry with data
ltc kb set research google holiday "Mother's Day"   # Set nested field
ltc kb remove research google legacy_data           # Remove a field
ltc kb delete research google                       # Delete entire entry
```

### MCP Servers

```bash
ltc mcp servers                           # List registered servers
ltc mcp tools SERVER_ID                   # List tools for a server
```

### Users (admin)

```bash
ltc users list
ltc users get USER_ID
```

### Roles

Roles are the queue-backed work surfaces where paused workflows hand off to people. Role schemas are versioned — every schema save adds an immutable snapshot, and escalations can pin one via `schemaVersion`.

```bash
ltc roles list                            # Roles with schema version, member and workflow counts
ltc roles schema reviewer                 # Latest form/metadata schema (with current version)
ltc roles schema reviewer --version 3     # Immutable v3 snapshot
ltc roles schema-versions reviewer        # Version history, newest first
ltc roles save-schema reviewer --file schema.json --summary "Added lotNumber"
                                          # Save the escalation form schema (a change creates the next version)
```

### Personas

Personas bundle roles into one-step assignments — each link carries a relationship scope (`write-all`, `write-self`, `read-all`). See [iam.md](iam.md#personas) for the semantics.

```bash
ltc personas list                         # Personas with role and holder counts
ltc personas get production-manager       # Role links + assignees
ltc personas assign production-manager USER_ID
ltc personas unassign production-manager USER_ID
ltc personas for-user USER_ID             # Personas held + composed role/scope map
```

### Compiler

```bash
ltc compile workflows/my-workflow.ts      # Compile durable → YAML
ltc compile src/workflows/ --dry-run      # Scan without compiling
ltc compile --model claude-opus-4-6    # Use a specific model
ltc init                                  # Create .env template
```

---

## Output Modes

Every list command supports three output modes:

```bash
ltc esc list                    # Formatted table (default)
ltc esc list --json             # Raw JSON (for jq, scripting)
ltc esc list -q                 # IDs only, one per line
```

Pipe-friendly:

```bash
ltc esc list --json | jq '.escalations[].id'
ltc pip list -q | xargs -I {} ltc pip get {}
```

---

## Configuration

| Variable | Description |
|---|---|
| `LT_SERVER` | Server URL (overrides stored credentials) |
| `LT_TOKEN` | JWT token (overrides stored credentials) |
| `ANTHROPIC_API_KEY` | Required for `ltc compile` (Claude models) |
| `OPENAI_API_KEY` | Required for `ltc compile` (OpenAI models) |
| `LT_LLM_MODEL_PRIMARY` | Model for compilation (default: `claude-sonnet-4-6`) |

Credentials file: `~/.config/longtail/credentials.json`

---

## Aliases

| Full | Short |
|---|---|
| `ltc escalations` | `ltc esc` |
| `ltc workflows` | `ltc wf` |
| `ltc pipelines` | `ltc pip` |
| `ltc knowledge` | `ltc kb` |
