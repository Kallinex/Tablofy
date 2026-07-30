process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.REDIS_HOST = 'localhost';
process.env.REDIS_PORT = '6379';
process.env.JWT_SECRET = 'test-secret-at-least-32-characters-long!!';
process.env.WEBHOOK_ENCRYPTION_KEY = 'test-key-32-bytes-x-for-aes-256-gcm';
process.env.METRICS_AUTH_TOKEN = 'test-token';
