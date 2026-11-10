/** A binding request refused: bad input, access, a missing scheme, or a value already bound. */
export class BindingError extends Error {
  constructor(public status: 400 | 403 | 404 | 409, message: string) {
    super(message);
    this.name = 'BindingError';
  }
}
