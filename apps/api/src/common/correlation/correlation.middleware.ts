import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { CorrelationService } from './correlation.service';

interface RequestWithUser extends Request {
  tenantId?: string;
  user?: {
    sub?: string;
    id?: string;
    tenantId?: string;
  };
}

@Injectable()
export class CorrelationMiddleware implements NestMiddleware {
  constructor(private readonly correlationService: CorrelationService) {}

  use(req: Request, res: Response, next: NextFunction) {
    const requestId = (req.headers['x-request-id'] as string) || uuidv4();
    const correlationId = (req.headers['x-correlation-id'] as string) || requestId;
    const authenticatedReq = req as RequestWithUser;

    res.setHeader('X-Request-ID', requestId);
    res.setHeader('X-Correlation-ID', correlationId);

    this.correlationService.run(
      {
        requestId,
        correlationId,
        tenantId: authenticatedReq.tenantId || authenticatedReq.user?.tenantId,
        userId: authenticatedReq.user?.sub || authenticatedReq.user?.id,
      },
      () => next(),
    );
  }
}
