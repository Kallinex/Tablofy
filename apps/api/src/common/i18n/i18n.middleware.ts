import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

@Injectable()
export class I18nMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction) {
    const acceptLanguage = req.headers['accept-language'] as string | undefined;
    const supported = ['en', 'ar'];
    let lang = 'en';

    if (acceptLanguage) {
      const preferred = acceptLanguage.split(',')[0].substring(0, 2).toLowerCase();
      if (supported.includes(preferred)) {
        lang = preferred;
      }
    }

    (req as Request & { lang: string }).lang = lang;
    next();
  }
}
