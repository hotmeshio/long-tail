export {
  parseScanCode,
  fixedCodeLengths,
  compilePattern,
  patternsMatch,
  PATTERN_CODE_MAX_LENGTH,
  unanchorPattern,
  type ParseableScheme,
  type ParsedCode,
  type ScanParseFailure,
  type ScanParseResult,
} from './parse';
export { facetHolds, facetTarget } from './target';
export { isValidGtin, normalizeGtin, displayGtin, GTIN_CODE_LENGTHS } from './gtin';
