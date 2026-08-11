import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

interface Compose {
  services: Record<
    string,
    { ports?: string[]; environment?: Record<string, string>; command?: string }
  >;
}

function loadCompose(fileName: string): Compose {
  const filePath = path.resolve(__dirname, '..', '..', '..', '..', 'docker', fileName);
  return yaml.load(fs.readFileSync(filePath, 'utf8')) as Compose;
}

describe('docker-compose hardening (P1-09)', () => {
  describe('docker-compose.yml', () => {
    const compose = loadCompose('docker-compose.yml');

    it('binds postgres and redis to 127.0.0.1 only', () => {
      expect(compose.services.postgres.ports).toContain('127.0.0.1:5432:5432');
      expect(compose.services.redis.ports).toContain('127.0.0.1:6379:6379');
    });

    it('wires an optional redis password through to the server and healthcheck', () => {
      expect(compose.services.redis.environment?.REDIS_PASSWORD).toContain('REDIS_PASSWORD');
      expect(compose.services.redis.command).toContain('--requirepass');
      expect(compose.services.redis.command).toContain('REDIS_PASSWORD:+');
    });

    it('defaults the dev redis password to a strong non-empty value', () => {
      const value = compose.services.redis.environment?.REDIS_PASSWORD ?? '';
      const defaultPart = value.split(':-')[1] ?? '';
      expect(defaultPart.length).toBeGreaterThanOrEqual(32);
      expect(defaultPart).not.toContain(' ');
    });

    it('keeps the development default for POSTGRES_PASSWORD', () => {
      expect(compose.services.postgres.environment?.POSTGRES_PASSWORD).toContain(':-');
    });
  });

  describe('docker-compose.prod.yml', () => {
    const compose = loadCompose('docker-compose.prod.yml');

    it('binds postgres and redis to 127.0.0.1 only', () => {
      expect(compose.services.postgres.ports).toContain('127.0.0.1:5432:5432');
      expect(compose.services.redis.ports).toContain('127.0.0.1:6379:6379');
    });

    it('requires POSTGRES_PASSWORD to be set for the database and the DATABASE_URL', () => {
      expect(compose.services.postgres.environment?.POSTGRES_PASSWORD).toContain(':?');
      expect(compose.services.api.environment?.DATABASE_URL).toContain('POSTGRES_PASSWORD:?');
    });

    it('wires an optional redis password through to the server and healthcheck', () => {
      expect(compose.services.redis.environment?.REDIS_PASSWORD).toContain('REDIS_PASSWORD');
      expect(compose.services.redis.command).toContain('--requirepass');
      expect(compose.services.redis.command).toContain('REDIS_PASSWORD:+');
    });

    it('requires REDIS_PASSWORD to be set for both redis and the api', () => {
      expect(compose.services.redis.environment?.REDIS_PASSWORD).toContain(':?');
      expect(compose.services.api.environment?.REDIS_PASSWORD).toContain(':?');
    });
  });
});
