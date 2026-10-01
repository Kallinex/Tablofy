import { Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'crypto';

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

/**
 * Guards the OpenAPI document (which enumerates every endpoint and DTO) behind
 * HTTP Basic auth. In production the docs are opt-in, and when they are on they
 * must never be publicly reachable.
 */
export function createSwaggerBasicAuthMiddleware(
  expectedUser: string,
  expectedPassword: string,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, res: Response, next: NextFunction): void => {
    const header = req.headers.authorization ?? '';
    const [scheme, encoded] = header.split(' ');

    if (scheme === 'Basic' && encoded) {
      const decoded = Buffer.from(encoded, 'base64').toString('utf-8');
      const separator = decoded.indexOf(':');
      const user = separator === -1 ? decoded : decoded.slice(0, separator);
      const password = separator === -1 ? '' : decoded.slice(separator + 1);

      if (safeEqual(user, expectedUser) && safeEqual(password, expectedPassword)) {
        next();
        return;
      }
    }

    res.setHeader('WWW-Authenticate', 'Basic realm="Tablofy API Docs", charset="UTF-8"');
    res.status(401).json({ statusCode: 401, message: 'Unauthorized' });
  };
}
