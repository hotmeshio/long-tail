import type { AuthPayload } from './auth';

declare global {
  namespace Express {
    interface Request {
      auth?: AuthPayload;
    }
  }
}
