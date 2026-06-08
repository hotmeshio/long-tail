# Vision

Image analysis and description using LLM vision. Analyzes images to extract structured data, text content, and descriptions.

| Property | Value |
|----------|-------|
| Server ID | `long-tail-vision` |
| Category | Analysis |
| AI required | Yes |
| Credential providers | anthropic |

## Compile Hints

Vision tools process one image at a time. The argument name is `image` (NOT `image_path`). It accepts a storage path, data URI, or https:// URL. Vision tools do NOT use browser sessions. Do NOT wire page_id or _handle to vision tools. analyze_image output fields: description (string), text_content (string), objects (array).

## Tools

### analyze_image

Analyze an image and extract structured data.

| | |
|---|---|
| Read-safe | Yes |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| image | string | Yes | Image source: storage path, data URI, or https:// URL. |
| prompt | string | No | Optional prompt to guide the analysis. |

### describe_image

Generate a detailed description of an image.

| | |
|---|---|
| Read-safe | Yes |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| image | string | Yes | Image source: storage path, data URI, or https:// URL. |
| context | string | No | Optional context to guide the description. |
