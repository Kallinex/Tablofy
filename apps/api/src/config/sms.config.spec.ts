import 'reflect-metadata';
import smsConfig from './sms.config';

const SMS_ENV_KEYS = ['SMS_PROVIDER_URL', 'SMS_API_KEY'] as const;

function withEnv(env: Record<string, string | undefined>, fn: () => void): void {
  const saved: Record<string, string | undefined> = {};
  for (const key of Object.keys(env)) {
    saved[key] = process.env[key];
    if (env[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = env[key] as string;
    }
  }
  try {
    fn();
  } finally {
    for (const key of Object.keys(env)) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key] as string;
      }
    }
  }
}

const read = (extra: Record<string, string | undefined> = {}) => {
  let result!: ReturnType<typeof smsConfig>;
  withEnv({ ...Object.fromEntries(SMS_ENV_KEYS.map((k) => [k, undefined])), ...extra }, () => {
    result = smsConfig();
  });
  return result;
};

describe('sms.config', () => {
  it('reports an unconfigured SMS gateway as empty strings rather than undefined', () => {
    const config = read();
    expect(config.providerUrl).toBe('');
    expect(config.apiKey).toBe('');
  });

  it('reads the provider URL and API key when set', () => {
    const config = read({
      SMS_PROVIDER_URL: 'https://sms.example.com/health',
      SMS_API_KEY: 'secret-key',
    });

    expect(config.providerUrl).toBe('https://sms.example.com/health');
    expect(config.apiKey).toBe('secret-key');
  });

  it('allows a provider URL without an API key', () => {
    const config = read({ SMS_PROVIDER_URL: 'https://sms.example.com/health' });

    expect(config.providerUrl).toBe('https://sms.example.com/health');
    expect(config.apiKey).toBe('');
  });

  it('preserves values verbatim instead of trimming, matching the rest of the config', () => {
    const config = read({ SMS_PROVIDER_URL: ' https://sms.example.com ', SMS_API_KEY: ' k ' });

    expect(config.providerUrl).toBe(' https://sms.example.com ');
    expect(config.apiKey).toBe(' k ');
  });
});
