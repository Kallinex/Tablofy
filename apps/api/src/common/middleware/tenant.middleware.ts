import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { CurrentUserData } from '../decorators/current-user.decorator';

@Injectable()
export class TenantMiddleware implements NestMiddleware {
  private readonly logger = new Logger(TenantMiddleware.name);

  use(req: Request, _res: Response, next: NextFunction): void {
    const user = req.user as CurrentUserData | undefined;

    if (user?.tenantId) {
      req.tenantId = user.tenantId;
    }

    next();
  }
}
