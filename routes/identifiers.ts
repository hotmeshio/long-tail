import { Router } from '../lib/http';

import * as api from '../api/identifiers';

const router = Router();

const scheme = (value: unknown) => Number(value);
const flag = (value: unknown) => value === 'true' || value === '1';
const int = (value: unknown) => (value === undefined ? undefined : Number(value));

/** GET /api/identifiers/:scheme/bindings?target=&raw=&includeRetired=&limit=&offset= */
router.get('/:scheme/bindings', async (req, res) => {
  const result = await api.listIdentifierBindings({
    scheme: scheme(req.params.scheme),
    ...(req.query.target ? { target: String(req.query.target) } : {}),
    ...(req.query.raw ? { raw: String(req.query.raw) } : {}),
    includeRetired: flag(req.query.includeRetired),
    limit: int(req.query.limit), offset: int(req.query.offset),
  });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/** POST /api/identifiers/:scheme/bindings, body { raw, target } */
router.post('/:scheme/bindings', async (req, res) => {
  const result = await api.bindIdentifier({ scheme: scheme(req.params.scheme), raw: req.body?.raw, target: req.body?.target }, req.auth!);
  res.status(result.status).json(result.data ?? { error: result.error });
});

/** POST /api/identifiers/:scheme/rebind, body { raw, target } */
router.post('/:scheme/rebind', async (req, res) => {
  const result = await api.rebindIdentifier({ scheme: scheme(req.params.scheme), raw: req.body?.raw, target: req.body?.target }, req.auth!);
  res.status(result.status).json(result.data ?? { error: result.error });
});

/** DELETE /api/identifiers/:scheme/bindings/:id: retires the binding */
router.delete('/:scheme/bindings/:id', async (req, res) => {
  const result = await api.retireIdentifierBinding({ scheme: scheme(req.params.scheme), id: String(req.params.id) }, req.auth!);
  res.status(result.status).json(result.data ?? { error: result.error });
});

export default router;
