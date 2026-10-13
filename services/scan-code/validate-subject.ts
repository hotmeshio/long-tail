import {
  SCAN_FILL_SEPARATOR_DEFAULT,
  SCAN_HOLD_TTL_MAX_SECONDS,
  SCAN_HOLD_TTL_MIN_SECONDS,
  SCAN_VERBS,
  type ScanStep,
  type ScanStepParams,
} from '../../types';
import { FACET_KEY } from '../escalation/facet-sql';

function isSchemeList(value: unknown): value is number[] {
  return Array.isArray(value) && value.length > 0
    && value.every((v) => Number.isInteger(v) && v >= 10 && v <= 99);
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === 'string' && v);
}

function isPlainObject(value: unknown): boolean {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Hold, fill, and the subject vocabulary (subject gate, match, refuse,
 * accumulate from/into). A step that can never find its subject, or a
 * guard that can never pass, fails the upsert rather than the bench.
 */
export function assertValidSubjectStep(step: ScanStep, at: string): void {
  const accumulate = step.params?.accumulate;
  const subjectMode = accumulate?.from === 'subject' || accumulate?.into === 'subject'
    || (step.verb === SCAN_VERBS.FILL && step.params?.fill?.into === 'subject');

  if (step.subject !== undefined) {
    if (!isPlainObject(step.subject) || !isSchemeList(step.subject.schemes)) {
      throw new Error(`${at}: subject.schemes must be a non-empty array of scheme versions (10-99)`);
    }
    if (step.subject.claimedByOther !== undefined
      && step.subject.claimedByOther !== 'refuse' && step.subject.claimedByOther !== 'allow') {
      throw new Error(`${at}: subject.claimedByOther must be 'refuse' or 'allow'`);
    }
    const facets = step.subject.facets;
    if (facets !== undefined) {
      if (!facets || typeof facets !== 'object' || Array.isArray(facets) || Object.keys(facets).length === 0) {
        throw new Error(`${at}: subject.facets must be a non-empty object`);
      }
      for (const [key, value] of Object.entries(facets)) {
        if (!FACET_KEY.test(key)) throw new Error(`${at}: subject.facets key "${key}" must be a facet key`);
        if (!['string', 'number', 'boolean'].includes(typeof value)) {
          throw new Error(`${at}: subject.facets.${key} must be a string, number, or boolean`);
        }
      }
    }
    if (step.verb !== SCAN_VERBS.ACCUMULATE && step.verb !== SCAN_VERBS.FILL) {
      throw new Error(`${at}: a subject gate applies only to accumulate and fill steps`);
    }
    if (step.confirm) throw new Error(`${at}: a subject step acts on the scan; it cannot carry confirm`);
    if (!subjectMode) {
      throw new Error(`${at}: a subject step must act on it (accumulate from/into 'subject', or fill into 'subject')`);
    }
  } else if (subjectMode) {
    throw new Error(`${at}: acting on the held subject requires a subject gate`);
  }

  if (accumulate?.from !== undefined && accumulate.from !== 'subject') {
    throw new Error(`${at}: params.accumulate.from must be 'subject'`);
  }
  if (accumulate?.into !== undefined && accumulate.into !== 'subject') {
    throw new Error(`${at}: params.accumulate.into must be 'subject'`);
  }
  if (accumulate?.from && accumulate.into) {
    throw new Error(`${at}: params.accumulate.from and into are exclusive`);
  }
  if ((accumulate?.from || accumulate?.into) && accumulate.containerFacet) {
    throw new Error(`${at}: params.accumulate.containerFacet is item mode; drop it for from/into 'subject'`);
  }
  if (accumulate?.item !== undefined) assertValidItemSelector(accumulate, at);
  if (accumulate?.from && !step.params?.itemKey) {
    throw new Error(`${at}: from-subject accumulate requires params.itemKey (e.g. '{subject.<facet>}')`);
  }

  if (step.match !== undefined) {
    if (!step.subject) throw new Error(`${at}: match applies only to steps with a subject gate`);
    if (!isPlainObject(step.match)) throw new Error(`${at}: match must be an object`);
    if (step.match.target === undefined && step.match.facets === undefined) {
      throw new Error(`${at}: match needs target or facets`);
    }
    if (step.match.target !== undefined && !isStringList(step.match.target)) {
      throw new Error(`${at}: match.target must be a non-empty array of templates`);
    }
    if (step.match.facets !== undefined) {
      if (!isStringList(step.match.facets) || !step.match.facets.every((f) => FACET_KEY.test(f))) {
        throw new Error(`${at}: match.facets must be a non-empty array of facet keys`);
      }
      if (accumulate?.from !== 'subject') {
        throw new Error(`${at}: match.facets compares the located container, which only a from-subject accumulate has`);
      }
    }
  }

  if (step.refuse !== undefined) {
    if (!isPlainObject(step.refuse) || typeof step.refuse.markdown !== 'string' || !step.refuse.markdown) {
      throw new Error(`${at}: refuse.markdown is required`);
    }
    if (step.refuse.conflict !== undefined && typeof step.refuse.conflict !== 'string') {
      throw new Error(`${at}: refuse.conflict must be markdown`);
    }
    if (step.refuse.missing !== undefined) {
      if (typeof step.refuse.missing !== 'string' || !step.refuse.missing) {
        throw new Error(`${at}: refuse.missing must be markdown`);
      }
      if (accumulate?.from !== 'subject' && !(accumulate?.into === 'subject' && accumulate.item)) {
        throw new Error(`${at}: refuse.missing applies only to a from-subject accumulate, or an into-subject accumulate with item`);
      }
    }
  }

  if (step.verb === SCAN_VERBS.HOLD) assertValidHold(step, at);
  else if (step.params?.hold !== undefined) throw new Error(`${at}: params.hold applies only to hold steps`);

  if (step.verb === SCAN_VERBS.FILL) assertValidFill(step, at);
  else if (step.params?.fill !== undefined) throw new Error(`${at}: params.fill applies only to fill steps`);
}

function assertValidItemSelector(accumulate: NonNullable<ScanStepParams['accumulate']>, at: string): void {
  const item = accumulate.item;
  if (accumulate.into !== 'subject') {
    throw new Error(`${at}: params.accumulate.item applies only to an into-subject accumulate`);
  }
  if (!isPlainObject(item)) throw new Error(`${at}: params.accumulate.item must be an object`);
  if (item!.roles !== undefined && !isStringList(item!.roles)) {
    throw new Error(`${at}: params.accumulate.item.roles must be a non-empty array of roles`);
  }
  if (item!.types !== undefined && !isStringList(item!.types)) {
    throw new Error(`${at}: params.accumulate.item.types must be a non-empty array of strings`);
  }
  if (item!.subtypes !== undefined && !isStringList(item!.subtypes)) {
    throw new Error(`${at}: params.accumulate.item.subtypes must be a non-empty array of strings`);
  }
  if (item!.facets !== undefined) {
    if (!isPlainObject(item!.facets)) throw new Error(`${at}: params.accumulate.item.facets must be an object`);
    for (const key of Object.keys(item!.facets!)) {
      if (!FACET_KEY.test(key)) throw new Error(`${at}: params.accumulate.item.facets key "${key}" must be a facet key`);
    }
  }
}

function assertValidHold(step: ScanStep, at: string): void {
  if (step.cardinality === 'many') throw new Error(`${at}: hold locates a single row (cardinality first)`);
  const hold = step.params?.hold;
  if (hold === undefined) return;
  if (!isPlainObject(hold)) throw new Error(`${at}: params.hold must be an object`);
  if (hold.ttlSeconds !== undefined && (!Number.isInteger(hold.ttlSeconds)
    || hold.ttlSeconds < SCAN_HOLD_TTL_MIN_SECONDS || hold.ttlSeconds > SCAN_HOLD_TTL_MAX_SECONDS)) {
    throw new Error(`${at}: params.hold.ttlSeconds must be ${SCAN_HOLD_TTL_MIN_SECONDS}-${SCAN_HOLD_TTL_MAX_SECONDS}`);
  }
  if (hold.label !== undefined && typeof hold.label !== 'string') {
    throw new Error(`${at}: params.hold.label must be a template string`);
  }
  if (hold.expect !== undefined) {
    if (!isPlainObject(hold.expect) || !isSchemeList(hold.expect.schemes)) {
      throw new Error(`${at}: params.hold.expect.schemes must be a non-empty array of scheme versions`);
    }
    if (hold.expect.prompt !== undefined && typeof hold.expect.prompt !== 'string') {
      throw new Error(`${at}: params.hold.expect.prompt must be markdown`);
    }
  }
}

function assertValidFill(step: ScanStep, at: string): void {
  const fill = step.params?.fill;
  if (!fill || !isPlainObject(fill)) throw new Error(`${at}: fill requires params.fill`);
  if (fill.into !== 'subject' && fill.into !== 'scanned') {
    throw new Error(`${at}: params.fill.into must be 'subject' or 'scanned'`);
  }
  const separator = fill.separator ?? SCAN_FILL_SEPARATOR_DEFAULT;
  if (typeof separator !== 'string' || separator.length !== 1) {
    throw new Error(`${at}: params.fill.separator must be one character`);
  }
  if (fill.payload !== undefined && !isPlainObject(fill.payload)) {
    throw new Error(`${at}: params.fill.payload must be an object`);
  }
  if (step.confirm) throw new Error(`${at}: fill cannot carry confirm`);
}
