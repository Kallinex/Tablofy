import { Test, TestingModule } from '@nestjs/testing';
import { IntegrationsService } from '../integrations.service';
import { IntegrationProvider } from '../interfaces/integration-provider.interface';

const makeProvider = (type: IntegrationProvider['type'], name: string): IntegrationProvider => ({
  type,
  name,
  initialize: jest.fn().mockResolvedValue(undefined),
  validateConnection: jest.fn().mockResolvedValue({ success: true, data: true }),
  healthCheck: jest.fn().mockResolvedValue({ success: true, data: { status: 'ok', latencyMs: 1 } }),
});

describe('IntegrationsService', () => {
  let service: IntegrationsService;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [IntegrationsService],
    }).compile();

    service = module.get<IntegrationsService>(IntegrationsService);
  });

  beforeEach(() => {
    service.getAllProviders().forEach((p) => service.removeProvider(p.type, p.name));
  });

  it('starts with no registered providers', () => {
    expect(service.getAllProviders()).toEqual([]);
  });

  it('registers providers and returns them by type and name', () => {
    const stripe = makeProvider('stripe', 'stripe-main');
    const plainStripe = makeProvider('stripe', 'stripe-eu');
    const email = makeProvider('email', 'smtp');

    service.registerProvider(stripe);
    service.registerProvider(plainStripe);
    service.registerProvider(email);

    expect(service.getProvider('stripe', 'stripe-main')).toBe(stripe);
    expect(service.getProvider('email')).toBe(email);
    expect(service.getProvidersByType('stripe')).toEqual([stripe, plainStripe]);
  });

  it('replacing a provider with the same type and name overwrites it', () => {
    const first = makeProvider('sms', 'twilio');
    const second = makeProvider('sms', 'twilio');

    service.registerProvider(first);
    service.registerProvider(second);

    expect(service.getProvider('sms', 'twilio')).toBe(second);
    expect(service.getAllProviders()).toHaveLength(1);
  });

  it('returns undefined for an unknown provider', () => {
    expect(service.getProvider('xero')).toBeUndefined();
    expect(service.getProvider('xero', 'missing')).toBeUndefined();
  });

  it('removes a provider and reports whether it existed', () => {
    service.registerProvider(makeProvider('whatsapp', 'wa'));

    expect(service.removeProvider('whatsapp', 'wa')).toBe(true);
    expect(service.removeProvider('whatsapp', 'wa')).toBe(false);
    expect(service.getProvidersByType('whatsapp')).toEqual([]);
  });
});
