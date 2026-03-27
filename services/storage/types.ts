export interface StorageBackend {
  /** Write data to storage. Returns the key and size. */
  write(key: string, data: Buffer): Promise<{ ref: string; size: number }>;

  /** Read data from storage. Returns the raw buffer and size. */
  read(key: string): Promise<{ data: Buffer; size: number }>;

  /** List files under a prefix/directory, optionally filtered by glob pattern. */
  list(prefix?: string, pattern?: string): Promise<{
    files: Array<{ path: string; size: number; modified_at: string }>;
  }>;

  /** Delete a file. Returns whether it existed. */
  delete(key: string): Promise<{ deleted: boolean }>;

  /**
   * Get a local filesystem path for tools that need to write directly (e.g. Playwright).
   * For local backend: returns the final storage path.
   * For S3 backend: returns a temp staging path.
   * Caller MUST call commitLocalPath() after writing to it.
   */
  getLocalPath(key: string): Promise<string>;

  /**
   * Commit a file written to a local path into storage.
   * For local backend: no-op (file is already in place).
   * For S3 backend: uploads the file, then removes the temp file.
   */
  commitLocalPath(key: string, localPath: string): Promise<{ size: number }>;

  /** Create a readable stream for HTTP serving. */
  createReadStream(key: string): Promise<NodeJS.ReadableStream>;
}
