import { INestApplicationContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { SocketIoAdapter } from '../socket-io.adapter';

describe('SocketIoAdapter (server-wide CORS policy)', () => {
  let config: ConfigService;

  function makeApp(): SocketIoAdapter {
    const app = {
      get: () => config,
    } as unknown as INestApplicationContext;
    return new SocketIoAdapter(app);
  }

  beforeEach(() => {
    config = new ConfigService();
  });

  it('merges config-driven cors options onto the socket.io server options', () => {
    config = {
      get: jest.fn((key: string) => (key === 'app.nodeEnv' ? 'development' : undefined)),
    } as unknown as ConfigService;
    const adapter = makeApp();
    const spy = jest
      .spyOn(IoAdapter.prototype, 'createIOServer')
      .mockImplementation((_port, options) => options);

    const options = adapter.createIOServer(3001);
    expect(spy).toHaveBeenCalledWith(3001, expect.objectContaining({ cors: expect.any(Object) }));
    expect(options.cors).toBeDefined();
    spy.mockRestore();
  });

  it('applies a locked-down origin allowlist in production', () => {
    config = {
      get: jest.fn((key: string) => {
        if (key === 'app.nodeEnv') return 'production';
        if (key === 'app.corsOrigins') return ['https://app.example.com'];
        return undefined;
      }),
    } as unknown as ConfigService;
    const adapter = makeApp();
    const spy = jest
      .spyOn(IoAdapter.prototype, 'createIOServer')
      .mockImplementation((_port, options) => options);

    const options = adapter.createIOServer(3001);
    expect(options.cors.origin).toEqual(['https://app.example.com']);
    spy.mockRestore();
  });

  it('allows any origin outside production', () => {
    config = {
      get: jest.fn((key: string) => (key === 'app.nodeEnv' ? 'development' : undefined)),
    } as unknown as ConfigService;
    const adapter = makeApp();
    const spy = jest
      .spyOn(IoAdapter.prototype, 'createIOServer')
      .mockImplementation((_port, options) => options);

    const options = adapter.createIOServer(3001);
    expect(options.cors.origin).toBe(true);
    spy.mockRestore();
  });
});
