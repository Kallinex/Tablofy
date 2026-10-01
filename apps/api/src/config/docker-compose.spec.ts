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

    it('fails fast unless production secrets and the mail transport are provided', () => {
      const env = compose.services.api.environment ?? {};
      expect(env.JWT_SECRET).toContain(':?');
      expect(env.JWT_REFRESH_SECRET).toContain(':?');
      expect(env.METRICS_AUTH_TOKEN).toContain(':?');
      expect(env.WEBHOOK_ENCRYPTION_KEY).toContain(':?');
      expect(env.SMTP_HOST).toContain(':?');
      expect(env.SMTP_FROM).toContain(':?');
    });

    it('trusts exactly one reverse-proxy hop by default', () => {
      expect(compose.services.api.environment?.TRUST_PROXY).toContain(':-1');
    });

    it('ships a TLS-terminating nginx reverse proxy fronting the api', () => {
      expect(compose.services.nginx).toBeDefined();
      expect(compose.services.nginx.environment?.SERVER_NAME).toContain('SERVER_NAME');
    });

    it('ships an offsite backup sidecar', () => {
      expect(compose.services.backup).toBeDefined();
      expect(compose.services.backup.environment?.RCLONE_REMOTE).toContain('RCLONE_REMOTE');
      expect(compose.services.backup.environment?.BACKUP_CRON).toContain('BACKUP_CRON');
    });
  });
});
