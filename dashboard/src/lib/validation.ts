// Canonical validation-error shapes live in the root types/ — the same module
// the API layer, SDK, and CLI use, so a 422 body narrows identically here.
export * from '../../../types/validation';
