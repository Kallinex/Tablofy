import { Request, Response, NextFunction } from 'express';
import { createSwaggerBasicAuthMiddleware } from '../swagger-auth.middleware';

interface MockRes {
  headers: Record<string, string>;
  statusCode: number;
  body: unknown;
  setHeader: jest.Mock;
  status: jest.Mock;
  json: jest.Mock;
}

function makeRes(): MockRes {
  const headers: Record<string, string> = {};
  const res: MockRes = {
    headers,
    statusCode: 0,
    body: undefined,
    setHeader: jest.fn((name: string, value: string) => {
      headers[name] = value;
    }),
    status: jest.fn((code: number) => {
      res.statusCode = code;
      return res;
    }),
    json: jest.fn((body: unknown) => {
      res.body = body;
      return res;
    }),
  };
  return res;
}

function basic(user: string, pass: string): string {
  return `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
}

describe('createSwaggerBasicAuthMiddleware', () => {
  const user = 'docs-admin';
  const password = 'sup3r-s3cret';

  it('calls next() for valid credentials', () => {
    const middleware = createSwaggerBasicAuthMiddleware(user, password);
    const req = { headers: { authorization: basic(user, password) } } as unknown as Request;
    const res = makeRes();
    const next = jest.fn() as NextFunction;

    middleware(req, res as unknown as Response, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('accepts a password that contains a colon', () => {
    const middleware = createSwaggerBasicAuthMiddleware(user, 'a:b:c');
    const req = { headers: { authorization: basic(user, 'a:b:c') } } as unknown as Request;
    const res = makeRes();
    const next = jest.fn() as NextFunction;

    middleware(req, res as unknown as Response, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('rejects a missing authorization header', () => {
    const middleware = createSwaggerBasicAuthMiddleware(user, password);
    const req = { headers: {} } as unknown as Request;
    const res = makeRes();
    const next = jest.fn() as NextFunction;

    middleware(req, res as unknown as Response, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.headers['WWW-Authenticate']).toContain('Basic');
    expect(res.body).toEqual({ statusCode: 401, message: 'Unauthorized' });
  });

  it('rejects a wrong password', () => {
    const middleware = createSwaggerBasicAuthMiddleware(user, password);
    const req = { headers: { authorization: basic(user, 'wrong') } } as unknown as Request;
    const res = makeRes();
    const next = jest.fn() as NextFunction;

    middleware(req, res as unknown as Response, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('rejects a non-Basic scheme', () => {
    const middleware = createSwaggerBasicAuthMiddleware(user, password);
    const req = { headers: { authorization: `Bearer ${password}` } } as unknown as Request;
    const res = makeRes();
    const next = jest.fn() as NextFunction;

    middleware(req, res as unknown as Response, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('rejects a Basic header with no payload', () => {
    const middleware = createSwaggerBasicAuthMiddleware(user, password);
    const req = { headers: { authorization: 'Basic' } } as unknown as Request;
    const res = makeRes();
    const next = jest.fn() as NextFunction;

    middleware(req, res as unknown as Response, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('rejects malformed base64 without throwing', () => {
    const middleware = createSwaggerBasicAuthMiddleware(user, password);
    const req = {
      headers: { authorization: `Basic ${Buffer.from(`${user}-no-separator`).toString('base64')}` },
    } as unknown as Request;
    const res = makeRes();
    const next = jest.fn() as NextFunction;

    expect(() => middleware(req, res as unknown as Response, next)).not.toThrow();
    expect(next).not.toHaveBeenCalled();
  });
});
