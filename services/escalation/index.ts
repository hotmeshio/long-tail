export * from './types';
export * from './crud';
export * from './bulk';
export * from './queries';
export { ensureEscalationCompatView } from './client';
export {
  ensureFacetReady,
  searchByFacets,
  searchGroups,
  countByFacets,
  claimGroups,
  claimByFacets,
} from './facets';
export {
  ensureAttainmentReady,
  computeAttainment,
  computeServicerProfile,
  setBaseline,
  getLatestBaseline,
  listBaselines,
} from './attainment';
export type {
  AttainmentQuery,
  ServicerQuery,
  AttainmentBucket,
  ServicerBucket,
  BaselineRef,
  SetBaselineInput,
} from './attainment';
export {
  ATTAINMENT_RANGES,
  ATTAINMENT_PIVOTS,
  SERVICER_COHORTS,
  isAttainmentRange,
  isAttainmentPivot,
  isServicerCohort,
} from './attainment-sql';
export type { AttainmentRangeKey, AttainmentPivot, ServicerCohort } from './attainment-sql';
export { buildReadScopeWhere } from './facet-sql';
export type { ReadScope } from './facet-sql';
