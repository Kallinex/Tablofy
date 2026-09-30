import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as request from 'supertest';
import { MetricsController } from '../metrics.controller';
import { MetricsService } from '../metrics.service';

const http = (request as unknown as { default?: typeof request }).default ?? request;

describe('MetricsController', () => {
  let app: INestApplication;

  const initApp = async (authToken: string): Promise<INestApplication> => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [MetricsController],
      providers: [
        {
          provide: MetricsService,
          useValue: { getMetrics: jest.fn().mockResolvedValue('# HELP up up\nup 1\n') },
        },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string, fallback?: unknown) =>
              key === 'metrics.authToken' ? authToken : fallback,
          },
        },
      ],
    }).compile();

    const instance = module.createNestApplication();
    await instance.init();
    return instance;
  };

  afterEach(async () => {
    await app?.close();
  });

  it('serves metrics in the Prometheus text exposition format', async () => {
    app = await initApp('');

    const res = await http(app.getHttpServer()).get('/metrics').expect(200);

    expect(res.text).toContain('# HELP');
    expect(res.text).toContain('up 1');
  });

  it('responds with the Prometheus content type so scrapers accept the payload', async () => {
    app = await initApp('');

    const res = await http(app.getHttpServer()).get('/metrics').expect(200);

    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.headers['content-type']).toContain('version=0.0.4');
  });

  it('rejects requests without the auth header when a token is configured', async () => {
    app = await initApp('an-observability-token');

    await http(app.getHttpServer()).get('/metrics').expect(401);
  });

  it('rejects requests with a wrong token', async () => {
    app = await initApp('an-observability-token');

    await http(app.getHttpServer())
      .get('/metrics')
      .set('authorization', 'Bearer wrong-token')
      .expect(401);
  });

  it('accepts the exact bearer token when a token is configured', async () => {
    app = await initApp('an-observability-token');

    const res = await http(app.getHttpServer())
      .get('/metrics')
      .set('authorization', 'Bearer an-observability-token')
      .expect(200);

    expect(res.text).toContain('# HELP');
  });
});
