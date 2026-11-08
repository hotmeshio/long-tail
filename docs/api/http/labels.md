# Labels API

Label templates, label sheets, badge reissue and the label ledger. All
endpoints require authentication. See [label-sheets.md](../../label-sheets.md)
for templates, sources, media and the credential rules.

| Endpoint | Access |
|---|---|
| `GET /api/labels/templates[?scheme=]`, `GET /api/labels/templates/:name` | Any signed-in user |
| `PUT /api/labels/templates/:name`, `DELETE /api/labels/templates/:name` | Role management |
| `GET /api/labels/media`, `GET /api/labels/transports` | Any signed-in user |
| `POST /api/labels/preview`, `POST /api/labels/issue`, `POST /api/labels/jobs/:id/reprint` | Item templates: admin or role management. Identity templates: `credentialIssuer`. |
| `POST /api/labels/badges/reissue` | `credentialIssuer` |
| `GET /api/labels/jobs`, `GET /api/labels/jobs/:id` | Any signed-in user; badge jobs only for credential issuers and their requester |

## Upsert a template

```
PUT /api/labels/templates/:name
```

```json
{
  "scheme_version": 14,
  "title": "Container",
  "codes": [
    { "category": "0", "tone": "solid" },
    { "category": "1", "caption": "Check out", "tone": "outline" }
  ],
  "text": { "title": "{target}", "lines": ["{item.subtitle}"] },
  "symbology": "code128",
  "media": "a4-l7160",
  "expected_revision": 3
}
```

**Response 200:** the stored template with its new `revision`. **400** names
the first problem (unknown token, a category with no rule, a credential token).
**409** when `expected_revision` is stale.

## Preview

```
POST /api/labels/preview
```

```json
{
  "template": "container",
  "source": { "kind": "range", "prefix": "A-", "from": 1, "to": 40 },
  "layout": { "media": "a4-l7160", "startPosition": 7 }
}
```

**Response 200:** `{ template, sheet, warnings, labelCount }`. `sheet` holds
pages of placed labels in millimetres. Sensitive templates come back masked.
Nothing is recorded.

## Issue

```
POST /api/labels/issue
```

```json
{
  "template": "associate-badge",
  "source": { "kind": "users", "userIds": ["2f0c…"] },
  "layout": { "media": "a4-cr80", "cutMarks": true },
  "output": "pdf",
  "confirm": true,
  "idempotencyKey": "optional-key",
  "destination": "optional, passed to a transport"
}
```

| `output` | Response |
|---|---|
| `sheet` | JSON `{ job, replay, warnings, sheet }` |
| `pdf` | `application/pdf` attachment |
| `zpl` | `application/vnd.zebra-zpl` attachment (thermal media only) |
| `transport:<name>` | JSON `{ job, replay, warnings, receipt }` |

Every response carries `Cache-Control: no-store` and `X-LT-Label-Job: <job id>`.

| Status | Meaning |
|---|---|
| 400 | Bad source, layout or output (ZPL on sheet stock, a pasted badge list) |
| 403 | No print access for this template |
| 404 | Unknown or disabled template |
| 428 | A sensitive template without `confirm: true` |
| 502 | The transport failed; the job is recorded |

## Reissue a badge

```
POST /api/labels/badges/reissue
```

```json
{ "userId": "2f0c…", "template": "associate-badge", "output": "sheet", "confirm": true }
```

Rotates the user's credential and prints the new badge. The response is an
issue response with `reissueJobId`, the ledger row of the rotation.

## History

```
GET /api/labels/jobs?template=&subjectUserId=&limit=&offset=
POST /api/labels/jobs/:id/reprint   { "indices": [0, 3], "output": "sheet", "confirm": true }
```

A reprint prints the job's source again with the template as it is now, the
whole job or the labels at `indices`, and records a new job.
