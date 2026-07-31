// Isomorphic implementation lives in shared/form-validation — the same reader
// governs the resolve precondition on the dashboard (UI honesty) and the API
// server (enforced contract).
export * from '../../../shared/form-validation/x-lt-submit-guard';
