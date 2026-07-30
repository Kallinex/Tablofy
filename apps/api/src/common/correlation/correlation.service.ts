import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { AsyncLocalStorage } from 'async_hooks';
import { v4 as uuidv4 } from 'uuid';

export interface CorrelationContext {
  requestId: string;
  correlationId: string;
  tenantId?: string;
  userId?: string;
}

@Injectable()
export class CorrelationService implements OnModuleDestroy {
  private readonly asyncLocalStorage = new AsyncLocalStorage<CorrelationContext>();

  get context(): CorrelationContext | undefined {
    return this.asyncLocalStorage.getStore();
  }

  get requestId(): string {
    return this.context?.requestId || 'unknown';
  }

  get correlationId(): string {
    return this.context?.correlationId || 'unknown';
  }

  get tenantId(): string | undefined {
    return this.context?.tenantId;
  }

  get userId(): string | undefined {
    return this.context?.userId;
  }

  run<T>(context: Partial<CorrelationContext>, fn: () => T): T {
    const existing = this.context ?? ({} as CorrelationContext);
    const merged: CorrelationContext = {
      requestId: context.requestId ?? existing.requestId ?? uuidv4(),
      correlationId: context.correlationId ?? existing.correlationId ?? uuidv4(),
      tenantId: context.tenantId ?? existing.tenantId,
      userId: context.userId ?? existing.userId,
    };
    return this.asyncLocalStorage.run(merged, fn);
  }

  onModuleDestroy() {
    this.asyncLocalStorage.disable();
  }
}
