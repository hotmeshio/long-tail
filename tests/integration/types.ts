/**
 * Shared types for integration tests.
 */

/** HTTP response wrapper returned by ApiClient methods. */
export interface ApiResponse<T = any> {
  status: number;
  data: T;
}
