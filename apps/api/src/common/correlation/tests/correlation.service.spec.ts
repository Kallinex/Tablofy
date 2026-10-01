import { CorrelationService } from '../correlation.service';

describe('CorrelationService', () => {
  let service: CorrelationService;

  beforeEach(() => {
    service = new CorrelationService();
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

  it('reports unknown identifiers outside any context', () => {
    expect(service.context).toBeUndefined();
    expect(service.requestId).toBe('unknown');
    expect(service.correlationId).toBe('unknown');
    expect(service.tenantId).toBeUndefined();
    expect(service.userId).toBeUndefined();
  });

  it('exposes the identifiers inside a run scope', () => {
    service.run(
      {
        requestId: 'req-1',
        correlationId: 'corr-1',
        tenantId: 'tenant-1',
        userId: 'user-1',
      },
      () => {
        expect(service.requestId).toBe('req-1');
        expect(service.correlationId).toBe('corr-1');
        expect(service.tenantId).toBe('tenant-1');
        expect(service.userId).toBe('user-1');
      },
    );
  });

  it('generates identifiers when none are supplied', () => {
    service.run({}, () => {
      expect(service.requestId).toMatch(/^[0-9a-f-]{36}$/);
      expect(service.correlationId).toMatch(/^[0-9a-f-]{36}$/);
      expect(service.context).toEqual({
        requestId: service.requestId,
        correlationId: service.correlationId,
        tenantId: undefined,
        userId: undefined,
      });
    });
  });

  it('inherits identifiers from an enclosing scope', () => {
    service.run({ requestId: 'req-2', correlationId: 'corr-2' }, () => {
      service.run({ tenantId: 'tenant-2' }, () => {
        expect(service.requestId).toBe('req-2');
        expect(service.correlationId).toBe('corr-2');
        expect(service.tenantId).toBe('tenant-2');
      });
    });
  });

  it('lets an inner scope override inherited values', () => {
    service.run({ requestId: 'req-3', correlationId: 'corr-3' }, () => {
      service.run({ correlationId: 'corr-override' }, () => {
        expect(service.correlationId).toBe('corr-override');
        expect(service.requestId).toBe('req-3');
      });
    });
  });

  it('restores the outer scope after the inner run completes', () => {
    service.run({ requestId: 'req-4' }, () => {
      service.run({ requestId: 'req-inner' }, () => undefined);
      expect(service.requestId).toBe('req-4');
    });
  });

  it('returns the callback result', () => {
    expect(service.run({}, () => 'result')).toBe('result');
  });

  it('clears the context once the storage is disabled', () => {
    service.run({ requestId: 'req-5' }, () => {
      expect(service.requestId).toBe('req-5');
    });
    service.onModuleDestroy();
    expect(service.requestId).toBe('unknown');
  });
});
