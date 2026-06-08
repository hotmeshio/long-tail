# Translation

Text translation using LLM. Translates content between languages with automatic source language detection.

| Property | Value |
|----------|-------|
| Server ID | `long-tail-translation` |
| Category | Analysis |
| AI required | Yes |
| Credential providers | anthropic |

## Tools

### translate_content

Translate content to target language.

| | |
|---|---|
| Read-safe | Yes |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| content | string | Yes | The content to translate. |
| target_language | string | Yes | Target language for the translation. |
| source_language | string | No | Source language. Auto-detected if omitted. |
