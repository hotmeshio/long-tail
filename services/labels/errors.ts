/** A label request refused before anything printed: bad input, access, or a missing confirmation. */
export class LabelRequestError extends Error {
  constructor(public status: 400 | 403 | 404 | 409 | 428 | 502, message: string) {
    super(message);
    this.name = 'LabelRequestError';
  }
}
