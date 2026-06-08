# Claude Code

Agentic coding assistant via Claude Code CLI. Execute development tasks: code generation, refactoring, file analysis, and multi-step workflows.

| Property | Value |
|----------|-------|
| Server ID | `long-tail-claude-code` |
| Category | Development |
| AI required | Yes |
| Credential providers | anthropic |

## Compile Hints

execute_task runs Claude Code as a subprocess. The `prompt` parameter is ALWAYS a dynamic trigger input. Keep prompts self-contained. For read-only analysis, restrict with allowed_tools: ["Read", "Grep", "Glob"].

## Tools

### execute_task

Run a task using Claude Code CLI.

| | |
|---|---|
| Read-safe | No |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| prompt | string | Yes | The task prompt to execute. |
| working_directory | string | No | Working directory for the task (default /app). |
| allowed_tools | string[] | No | Restrict which tools Claude Code may use. |
| max_turns | number | No | Maximum conversation turns (default 5). |
| model | string | No | Model to use for the task. |
| system_prompt | string | No | System prompt override. |
| timeout_ms | number | No | Timeout in milliseconds (default 120000). |
| credential_label | string | No | Credential label for API key resolution. |

### check_availability

Check if Claude Code CLI is installed and an API key is available.

| | |
|---|---|
| Read-safe | Yes |

**Parameters:** None.
