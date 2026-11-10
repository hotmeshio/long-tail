# Identifier bindings

A binding pairs a scanned value (`raw`) with the thing it stands for (`target`), under one scan scheme: a cartridge's tag with the material lot it carries, a plate with the printer it is aboard. Use one when the carrier cannot hold its own target: a factory-printed barcode, a tag's EPC, a reusable plate.

A raw has one live target at a time. A target holds any number of raws unless its scheme sets `identifier.exclusiveTarget`, in which case it holds one. Retired bindings are kept, so a raw's history reads back newest first.

A binding stores the target string only. What the target means (a lot's material and remaining quantity, a printer's state) stays on the host's own rows.

## Who binds

Binding and retiring take a role manager, or a role the scheme names in `identifier.binders`. A scheme declared at boot (`scanSchemes[]`) carries the same `identifier`; a code-owned scheme applies what its code declares on every boot, and a db-owned one is seeded with it once:

```jsonc
{ "version": 22, "name": "Plate", "target_facet": "plateCode", "encoding": "delimited",
  "identifier": { "binders": ["print-servicer"], "exclusiveTarget": true } }
```

Reading bindings takes any signed-in caller. Each binding records `bound_by` (the user, when the caller is one) and `bound_via`: `api`, `scan` or `workflow`.

## Operations

| Operation | What it does |
|---|---|
| bind | Pairs a raw with a target. A raw bound to another target answers 409; the same pair again answers 200 with the standing binding. Under an exclusive scheme, the target's old raw is retired in the same transaction |
| rebind | Moves a raw to a new target: its old binding (and, under an exclusive scheme, the target's old raw) is retired and the new one inserted in one transaction |
| retire | Ends one live binding; it stays as history, and the raw is free to bind again |
| resolve | A raw's live binding, or none |
| list | A scheme's live bindings, by target or raw, or every binding with `includeRetired` |

Partial unique indexes decide concurrent binds: of two binds of one raw, or two onto one exclusive target, exactly one lands.

## HTTP

| Method | Path | Body or query |
|---|---|---|
| `GET` | `/api/identifiers/:scheme/bindings` | `target`, `raw`, `includeRetired`, `limit`, `offset` |
| `POST` | `/api/identifiers/:scheme/bindings` | `{ raw, target }`; 201 bound, 200 already bound, 409 bound elsewhere, 403 not a binder |
| `POST` | `/api/identifiers/:scheme/rebind` | `{ raw, target }` |
| `DELETE` | `/api/identifiers/:scheme/bindings/:id` | Retires the binding; 404 when it is not live |

The SDK has the same as `lt.identifiers.listBindings`, `bind`, `rebind` and `retire`, and MCP has `list_identifier_bindings` (read safe; `raw` answers one value's live target).

## Binding at a station

A `bind` scan step binds the scanned value to the held item. Hold the item first (a `hold` step), then scan the value under a rule whose step binds:

```jsonc
{ "verb": "bind", "subject": { "schemes": [21] }, "params": { "bind": { "facet": "serialNumber" } },
  "done": { "markdown": "**{scan.target}** is on {subject.serialNumber}." } }
```

The binding is kept under `params.bind.scheme`, else the scanned code's scheme, and binds to the held row's `params.bind.facet`, else its scheme's target facet. The acting identity must be a binder. A value bound to something else is refused and the held item is kept, so the right value can be scanned next.

Two options make one scan finish a hand-off, as when a plate is loaded onto a printer:

- `move: true` moves a value bound elsewhere here, retiring its old binding in the same transaction (a rebind). Without it, such a value is refused.
- `resolve: { payload? }` resolves the held row once the value is bound, with the payload rendered from scan templates (`{scan.target}` is the bound value, `{subject.<facet>}` reads the held row), and releases it. The resolve runs through the `resolve` verb's guarded statement, so the row's write scope, claim and form apply.

```jsonc
{ "verb": "bind", "subject": { "schemes": [21] },
  "params": { "bind": { "move": true, "resolve": { "payload": { "plateId": "{scan.target}" } } } },
  "done": { "markdown": "**{scan.target}** is on {subject.serialNumber}." } }
```

The binding is written first and the row resolved after it, in two statements. A refused binding resolves nothing. A held row that has already ended answers as done and the binding stands; scanning again answers the binding as already in place.
