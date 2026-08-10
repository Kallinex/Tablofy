import { join } from 'path';
import { readFileSync } from 'fs';
import { createRequire } from 'module';

const req = createRequire(__filename);
const glob = req('glob') as typeof import('glob');

const srcRoot = join(__dirname, '..', '..', '..');

interface GatewayAudit {
  file: string;
  permissiveCors: boolean;
  rawTenantQuery: boolean;
  callsAuthenticate: boolean;
  callsResolveTenant: boolean;
  callsJoinAuthorizedRoom: boolean;
}

function auditGateways(): GatewayAudit[] {
  const files = glob.sync('**/*.gateway.ts', { cwd: srcRoot }) as string[];
  return files.map((file) => {
    const content = readFileSync(join(srcRoot, file), 'utf8');
    return {
      file,
      permissiveCors: /\bcors:\s*\{[^}]*origin:\s*['"]\*['"]/.test(content),
      rawTenantQuery: /handshake\.query\.tenantId/.test(content),
      callsAuthenticate: /\.authenticate\(client\)/.test(content),
      callsResolveTenant: /resolveRequestedTenantId\(client\)/.test(content),
      callsJoinAuthorizedRoom: /joinAuthorizedRoom\(/.test(content),
    };
  });
}

describe('WebSocket gateway hardening (deny-by-default tripwire)', () => {
  it('every gateway must call authenticate + joinAuthorizedRoom in handleConnection', () => {
    const offenders = auditGateways().filter(
      (g) => !g.callsAuthenticate || !g.callsJoinAuthorizedRoom,
    );
    expect(offenders).toEqual([]);
  });

  it('no gateway may read the raw client-supplied tenantId from the handshake query', () => {
    const offenders = auditGateways().filter((g) => g.rawTenantQuery);
    expect(offenders).toEqual([]);
  });

  it('every gateway resolves the tenant id via the normalized helper', () => {
    const offenders = auditGateways().filter((g) => !g.callsResolveTenant);
    expect(offenders).toEqual([]);
  });

  it('no gateway may enable permissive CORS (origin: *)', () => {
    const offenders = auditGateways().filter((g) => g.permissiveCors);
    expect(offenders).toEqual([]);
  });
});
