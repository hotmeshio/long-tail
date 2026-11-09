# Stored Files on an Escalation

An escalation can name **stored files** for the person who works it: the PDF a model read, a scanned card, a photo of a part. The refs ride the row; the bytes stay in file storage (S3, GCS through its S3 API, or MinIO locally). Readers receive time-limited signed links, and forms show the files through the `file.*` context domain with the `document` widget.

---

## The Ref

```json
{ "path": "referrals/R-1042.pdf", "as": "referral" }
{ "path": "scans/8f2c41", "as": "card", "name": "ID card", "contentType": "image/jpeg", "expiresIn": 1800 }
```

| Field | Required | Meaning |
|-------|----------|---------|
| `path` | yes | The storage key. A leading `/` is dropped; `.` and `..` segments are refused |
| `as` | yes | The form-context address, `file.<as>`: a letter or `_`, then letters, digits, `_` or `-` |
| `name` | no | The name the viewer shows and downloads under. Defaults to the key's last segment |
| `contentType` | no | The media type, for keys without an extension. Defaults to the type the extension names |
| `expiresIn` | no | The signed link's lifetime in seconds. Defaults to `LT_ESCALATION_FILE_URL_TTL_SECONDS` |

An escalation carries up to 32 refs, each `as` once. Refs live under the reserved `envelope.files` key: unindexed, beside `formDefaults` and `lookups`, never on the facet surface.

## Creating an Escalation with Files

Pass `files` to `conditional`:

```typescript
const review = await conditional<IntakeReviewV1>(signalId, {
  role: 'intake-verifier',
  description: `Account application — ${applicationId}`,
  envelope: { formDefaults: extraction.values, confidence: extraction.confidence },
  files: [
    { path: `intake/${applicationId}/application.pdf`, as: 'application' },
    { path: `intake/${applicationId}/id-card.jpg`, as: 'id_card', name: 'ID card' },
  ],
  schemaVersion: 1,
});
```

The refs fold into `envelope.files` as a pure transform, so a wait with files costs what one without does. A malformed ref throws before the row is written. Over `POST /api/escalations` the same check answers `400`, and naming any file takes builder access (superadmin or engineer): a ref hands every reader of the row a link to that object, the same reach as the file browser.

## The Grant and the Signing Window

The refs on the row are the grant. Any user who may read the escalation receives links to exactly the files it names:

```
GET /api/escalations/:id/files
→ { "files": [{ "as": "application", "path": "intake/APP-1042/application.pdf", "name": "application.pdf",
                "contentType": "application/pdf", "url": "https://…", "expiresAt": "2026-11-09T15:39:31.859Z" }] }
```

A link lives for the ref's `expiresIn`, or the default. When the reader holds the live claim, the link stretches to the claim's end, so a claimant's documents stay open for the whole claim. Every window is held within `LT_ESCALATION_FILE_URL_MIN_SECONDS` and `LT_ESCALATION_FILE_URL_MAX_SECONDS`.

| Variable | Default | Meaning |
|----------|---------|---------|
| `LT_ESCALATION_FILE_URL_TTL_SECONDS` | `900` | A link's lifetime when the ref names none |
| `LT_ESCALATION_FILE_URL_MIN_SECONDS` | `60` | The shortest link signed |
| `LT_ESCALATION_FILE_URL_MAX_SECONDS` | `14400` | The longest link signed, claim included |

A ref that cannot be signed answers with `error` in its entry; the batch always answers. The response carries `Cache-Control: no-store`.

The dashboard signs when the detail page opens and again on claim. A re-signed link for the same file keeps the open document and its place. A document that has not loaded and whose link has lapsed offers **Get a fresh link**; an open document outlives its link.

An agent reads the same answer with the `get_escalation_files` MCP tool, as the account it signed in with and under the same read check. SDK callers use `lt.escalations.getFiles({ id })`.

## Showing a File

The `document` widget renders a file in place. Point `x-lt-source` at the ref's address:

```json
{
  "application": {
    "type": "string",
    "title": "Application",
    "description": "The signed application as received.",
    "x-lt-widget": "document",
    "x-lt-source": "file.application"
  }
}
```

- **PDF**: continuous pages, fit to width, with paging, zoom and rotation. Pages paint as they near the view, so a long document opens fast.
- **Image**: fit to the frame, zoom and quarter-turn rotation, scrollable at any zoom.
- **Anything else**: an open link.

Every viewer carries open-in-a-new-tab and download. The field is display-only: it carries no answer and never reaches the payload. It stays readable and pageable before the claim and on a resolved row.

`x-lt-source` also takes an ordered list, and a field without a source shows its own value when that is an `http(s)` link. Conditions and help read the domain too: `"x-lt-showIf": "file.application"` shows a field when the row names that file, on the dashboard and in the server's enforcement pass alike.

### Beside the fields: `x-lt-layout: "split"`

A split form puts its documents in a pane beside the fields they verify. The pane stays in view while the fields scroll, and a lone document fills it. Below the split width the pane stacks above the fields. See [x-lt-layout.md](x-lt-layout.md#split-layout).

## Storage

- **S3 and MinIO**: links are presigned GETs against `LT_S3_PUBLIC_ENDPOINT`. The PDF viewer fetches the bytes, so the bucket's CORS rules must allow `GET` from the dashboard origin and expose `Accept-Ranges`, `Content-Range` and `Content-Length`; MinIO allows every origin by default. Images and open links need no CORS. Presigned links signed with temporary credentials end when those credentials do; keep `LT_ESCALATION_FILE_URL_MAX_SECONDS` within the session length.
- **Local**: links are `/api/files/<key>?token=…`, a JWT bound to the key, served same-origin under the app's base path.

Writes through the storage backend record each object's content type from its extension.

## Reference Example

`examples/workflows/document-intake/` stores a sample application (PDF) and ID card (image), proposes values with a confidence score each, and parks one review on `intake-verifier`. See [x-lt-confidence.md](x-lt-confidence.md).
