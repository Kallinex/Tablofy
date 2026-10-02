import { SsoController } from '../sso.controller';
import type { Request } from 'express';

describe('SsoController', () => {
  let controller: SsoController;
  let service: {
    createConnection: jest.Mock;
    listConnections: jest.Mock;
    getConnection: jest.Mock;
    updateConnection: jest.Mock;
    deleteConnection: jest.Mock;
    discoverByEmail: jest.Mock;
    beginAuthorization: jest.Mock;
    handleCallback: jest.Mock;
    handleSamlResponse: jest.Mock;
    samlMetadata: jest.Mock;
    exchangeAuthorizationCode: jest.Mock;
    failureRedirect: jest.Mock;
  };

  const user = { id: 'user-1', email: 'a@acme.com', role: 'OWNER', tenantId: 'tenant-1' };
  const req = { ip: '1.2.3.4', headers: { 'user-agent': 'jest' } } as unknown as Request;

  beforeEach(() => {
    service = {
      createConnection: jest.fn().mockResolvedValue({ id: 'conn-1' }),
      listConnections: jest.fn().mockResolvedValue([]),
      getConnection: jest.fn().mockResolvedValue({ id: 'conn-1' }),
      updateConnection: jest.fn().mockResolvedValue({ id: 'conn-1' }),
      deleteConnection: jest.fn().mockResolvedValue({ deleted: true }),
      discoverByEmail: jest.fn().mockResolvedValue({ available: false }),
      beginAuthorization: jest.fn().mockResolvedValue({ url: 'https://idp.test/authorize' }),
      handleCallback: jest.fn().mockResolvedValue({ redirectUrl: 'https://app.test/sso?code=x' }),
      handleSamlResponse: jest
        .fn()
        .mockResolvedValue({ redirectUrl: 'https://app.test/sso?code=saml' }),
      samlMetadata: jest.fn().mockResolvedValue('<EntityDescriptor />'),
      exchangeAuthorizationCode: jest.fn().mockResolvedValue({ user, tokens: {} }),
      failureRedirect: jest.fn().mockReturnValue('https://app.test/login?error=sso_failed'),
    };
    controller = new SsoController(service as never);
  });

  it('delegates connection management to the service', async () => {
    await controller.createConnection(
      { name: 'x', issuerUrl: 'https://idp.test', clientId: 'c', clientSecret: 's' },
      user,
    );
    expect(service.createConnection).toHaveBeenCalledWith('tenant-1', 'user-1', expect.any(Object));

    await controller.listConnections(user);
    expect(service.listConnections).toHaveBeenCalledWith('tenant-1');

    await controller.getConnection('conn-1', user);
    expect(service.getConnection).toHaveBeenCalledWith('tenant-1', 'conn-1');

    await controller.updateConnection('conn-1', { enabled: false }, user);
    expect(service.updateConnection).toHaveBeenCalledWith('tenant-1', 'user-1', 'conn-1', {
      enabled: false,
    });

    await controller.deleteConnection('conn-1', user);
    expect(service.deleteConnection).toHaveBeenCalledWith('tenant-1', 'user-1', 'conn-1');
  });

  it('delegates discovery and code exchange', async () => {
    await controller.discover({ email: 'a@acme.com' });
    expect(service.discoverByEmail).toHaveBeenCalledWith('a@acme.com');

    await controller.exchange({ code: '0123456789abcdef' }, req);
    expect(service.exchangeAuthorizationCode).toHaveBeenCalledWith('0123456789abcdef', {
      ipAddress: '1.2.3.4',
      userAgent: 'jest',
    });
  });

  it('returns the identity provider redirect on authorize', async () => {
    const result = await controller.authorize('conn-1', '/dashboard');
    expect(service.beginAuthorization).toHaveBeenCalledWith('conn-1', '/dashboard');
    expect(result).toEqual({ url: 'https://idp.test/authorize' });
  });

  it('returns the success url on a completed callback', async () => {
    const result = await controller.callback({ state: 's', code: 'c' } as never, req);
    expect(result).toEqual({ url: 'https://app.test/sso?code=x' });
  });

  it('returns the failure url when the callback fails', async () => {
    service.handleCallback.mockRejectedValue(new Error('boom'));
    const result = await controller.callback({ state: 's', code: 'c' } as never, req);
    expect(service.failureRedirect).toHaveBeenCalledWith('sso_failed');
    expect(result).toEqual({ url: 'https://app.test/login?error=sso_failed' });
  });

  it('rethrows the original error when no failure url is configured', async () => {
    service.handleCallback.mockRejectedValue(new Error('boom'));
    service.failureRedirect.mockReturnValue('');
    await expect(controller.callback({} as never, req)).rejects.toThrow('boom');
  });

  it('returns the success url on a completed SAML assertion', async () => {
    const result = await controller.samlAcs({ SAMLResponse: 'xml', RelayState: 'rs' }, req);
    expect(service.handleSamlResponse).toHaveBeenCalledWith(
      { SAMLResponse: 'xml', RelayState: 'rs' },
      { ipAddress: '1.2.3.4', userAgent: 'jest' },
    );
    expect(result).toEqual({ url: 'https://app.test/sso?code=saml' });
  });

  it('returns the failure url when the SAML assertion fails', async () => {
    service.handleSamlResponse.mockRejectedValue(new Error('boom'));
    const result = await controller.samlAcs({ SAMLResponse: 'xml', RelayState: 'rs' }, req);
    expect(result).toEqual({ url: 'https://app.test/login?error=sso_failed' });
  });

  it('rethrows when no SAML failure url is configured', async () => {
    service.handleSamlResponse.mockRejectedValue(new Error('boom'));
    service.failureRedirect.mockReturnValue('');
    await expect(controller.samlAcs({ SAMLResponse: 'xml' }, req)).rejects.toThrow('boom');
  });

  it('returns service provider metadata for a SAML connection', async () => {
    expect(await controller.samlMetadata('conn-1')).toBe('<EntityDescriptor />');
    expect(service.samlMetadata).toHaveBeenCalledWith('conn-1');
  });
});
