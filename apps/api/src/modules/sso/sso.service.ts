import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  UnauthorizedException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '@prisma/client';
import { Issuer, Client, generators } from 'openid-client';
import { SAML, ValidateInResponseTo } from '@node-saml/node-saml';
import { randomBytes } from 'crypto';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuthService, TokenPair, AuthUser } from '../auth/auth.service';
import { CreateSsoConnectionDto } from './dto/create-sso-connection.dto';
import { UpdateSsoConnectionDto } from './dto/update-sso-connection.dto';
import { deriveSsoKey, encryptSsoSecret, decryptSsoSecret } from './sso-crypto';
import { BCRYPT_ROUNDS } from '@tablofy/shared/constants';

const STATE_PREFIX = 'sso:state:';
const CODE_PREFIX = 'sso:code:';
const DEFAULT_SCOPES = 'openid email profile';
const OIDC = 'OIDC';
const SAML_PROTOCOL = 'SAML';

interface StoredState {
  connectionId: string;
  protocol: string;
  codeVerifier?: string;
  nonce?: string;
  redirectPath?: string;
}

interface SsoProfile {
  email?: string;
  emailVerified?: boolean;
  firstName?: string;
  lastName?: string;
  name?: string;
}

interface OidcProfileClaims {
  email?: string;
  email_verified?: boolean;
  given_name?: string;
  family_name?: string;
  name?: string;
}

interface SsoUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  tenantId: string | null;
  status: string;
}

export interface SsoConnectionFields {
  id: string;
  tenantId: string;
  name: string;
  type: string;
  issuerUrl: string | null;
  clientId: string | null;
  clientSecretEncrypted: string | null;
  idpEntityId: string | null;
  idpSsoUrl: string | null;
  idpCertificate: string | null;
  spEntityId: string | null;
  scopes: string;
  allowedEmailDomains: unknown;
  autoProvision: boolean;
  defaultRole: UserRole;
  enabled: boolean;
  lastUsedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class SsoService {
  private readonly logger = new Logger(SsoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
    private readonly authService: AuthService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  private get encryptionKey(): Buffer {
    const key = this.configService.get<string>('sso.encryptionKey', '');
    return deriveSsoKey(key);
  }

  private get callbackBaseUrl(): string {
    return this.configService.get<string>('sso.callbackBaseUrl', '').replace(/\/+$/, '');
  }

  private get stateTtl(): number {
    return this.configService.get<number>('sso.stateTtlSeconds', 600);
  }

  private get exchangeCodeTtl(): number {
    return this.configService.get<number>('sso.exchangeCodeTtlSeconds', 60);
  }

  private assertEnabled(): void {
    if (!this.configService.get<boolean>('sso.enabled', false)) {
      throw new ServiceUnavailableException('Single sign-on is not enabled');
    }
  }

  redirectUri(): string {
    return `${this.callbackBaseUrl}/auth/sso/callback`;
  }

  samlAcsUrl(): string {
    return `${this.callbackBaseUrl}/auth/sso/saml/acs`;
  }

  samlMetadataUrl(): string {
    return `${this.callbackBaseUrl}/auth/sso/saml/metadata`;
  }

  failureRedirect(reason?: string): string {
    const base = this.configService.get<string>('sso.failureRedirectUrl', '');
    if (!base) {
      return base;
    }
    const separator = base.includes('?') ? '&' : '?';
    return `${base}${separator}error=${encodeURIComponent(reason || 'sso_failed')}`;
  }

  // ============================================
  // Connection management (tenant admins)
  // ============================================

  async createConnection(tenantId: string, userId: string, dto: CreateSsoConnectionDto) {
    this.assertEnabled();

    const existing = await this.prisma.ssoConnection.findUnique({ where: { tenantId } });
    if (existing) {
      throw new ConflictException(
        'This tenant already has an SSO connection. Update or delete it first.',
      );
    }

    const type = (dto.type ?? OIDC).toUpperCase();
    const baseData = {
      tenantId,
      name: dto.name,
      type,
      allowedEmailDomains: dto.allowedEmailDomains
        ? dto.allowedEmailDomains.map((d) => d.toLowerCase())
        : undefined,
      autoProvision: dto.autoProvision ?? true,
      defaultRole: (dto.defaultRole as UserRole) ?? UserRole.STAFF,
      enabled: dto.enabled ?? false,
      createdBy: userId,
    };

    const connection = await this.prisma.ssoConnection.create({
      data:
        type === SAML_PROTOCOL
          ? { ...baseData, ...(await this.buildSamlData(dto)) }
          : { ...baseData, ...(await this.buildOidcData(dto)) },
    });

    await this.auditLogsService.log({
      action: 'SSO_CONNECTION_CREATED',
      resource: 'SsoConnection',
      resourceId: connection.id,
      userId,
      tenantId,
      newValues: { type, enabled: connection.enabled },
    });

    return this.sanitize(connection);
  }

  private async buildOidcData(dto: CreateSsoConnectionDto) {
    if (!dto.issuerUrl || !dto.clientId || !dto.clientSecret) {
      throw new BadRequestException(
        'OIDC connections require issuerUrl, clientId and clientSecret',
      );
    }
    await this.verifyIssuer(dto.issuerUrl);
    return {
      issuerUrl: dto.issuerUrl,
      clientId: dto.clientId,
      clientSecretEncrypted: encryptSsoSecret(dto.clientSecret, this.encryptionKey),
      scopes: dto.scopes && dto.scopes.length > 0 ? dto.scopes.join(' ') : DEFAULT_SCOPES,
    };
  }

  private async buildSamlData(dto: CreateSsoConnectionDto) {
    if (!dto.idpEntityId || !dto.idpSsoUrl || !dto.idpCertificate) {
      throw new BadRequestException(
        'SAML connections require idpEntityId, idpSsoUrl and idpCertificate',
      );
    }
    this.assertHttpsUrl(dto.idpSsoUrl, 'idpSsoUrl');
    return {
      issuerUrl: dto.issuerUrl ?? dto.idpEntityId,
      idpEntityId: dto.idpEntityId,
      idpSsoUrl: dto.idpSsoUrl,
      idpCertificate: dto.idpCertificate,
      spEntityId: dto.spEntityId ?? null,
    };
  }

  private async loadTenantConnection(tenantId: string, id: string): Promise<SsoConnectionFields> {
    const connection = await this.prisma.ssoConnection.findFirst({ where: { id, tenantId } });
    if (!connection) {
      throw new NotFoundException('SSO connection not found');
    }
    return connection as SsoConnectionFields;
  }

  async listConnections(tenantId: string) {
    const connections = await this.prisma.ssoConnection.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
    return connections.map((c) => this.sanitize(c as SsoConnectionFields));
  }

  async getConnection(tenantId: string, id: string) {
    return this.sanitize(await this.loadTenantConnection(tenantId, id));
  }

  async updateConnection(
    tenantId: string,
    userId: string,
    id: string,
    dto: UpdateSsoConnectionDto,
  ) {
    this.assertEnabled();
    const existing = await this.loadTenantConnection(tenantId, id);

    if (dto.type && dto.type !== existing.type) {
      throw new BadRequestException(
        'The SSO protocol cannot be changed. Delete the connection and create a new one.',
      );
    }

    if (dto.issuerUrl) {
      await this.verifyIssuer(dto.issuerUrl);
    }
    if (dto.idpSsoUrl) {
      this.assertHttpsUrl(dto.idpSsoUrl, 'idpSsoUrl');
    }

    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.issuerUrl !== undefined) data.issuerUrl = dto.issuerUrl;
    if (dto.clientId !== undefined) data.clientId = dto.clientId;
    if (dto.clientSecret !== undefined) {
      data.clientSecretEncrypted = encryptSsoSecret(dto.clientSecret, this.encryptionKey);
    }
    if (dto.idpEntityId !== undefined) data.idpEntityId = dto.idpEntityId;
    if (dto.idpSsoUrl !== undefined) data.idpSsoUrl = dto.idpSsoUrl;
    if (dto.idpCertificate !== undefined) data.idpCertificate = dto.idpCertificate;
    if (dto.spEntityId !== undefined) data.spEntityId = dto.spEntityId;
    if (dto.scopes !== undefined) {
      data.scopes = dto.scopes.length > 0 ? dto.scopes.join(' ') : DEFAULT_SCOPES;
    }
    if (dto.allowedEmailDomains !== undefined) {
      data.allowedEmailDomains = dto.allowedEmailDomains.map((d) => d.toLowerCase());
    }
    if (dto.autoProvision !== undefined) data.autoProvision = dto.autoProvision;
    if (dto.defaultRole !== undefined) data.defaultRole = dto.defaultRole as UserRole;
    if (dto.enabled !== undefined) data.enabled = dto.enabled;

    const connection = await this.prisma.ssoConnection.update({ where: { id }, data });

    await this.auditLogsService.log({
      action: 'SSO_CONNECTION_UPDATED',
      resource: 'SsoConnection',
      resourceId: id,
      userId,
      tenantId,
      newValues: { enabled: connection.enabled },
    });

    return this.sanitize(connection as SsoConnectionFields);
  }

  async deleteConnection(tenantId: string, userId: string, id: string) {
    await this.loadTenantConnection(tenantId, id);
    await this.prisma.ssoConnection.delete({ where: { id } });

    await this.auditLogsService.log({
      action: 'SSO_CONNECTION_DELETED',
      resource: 'SsoConnection',
      resourceId: id,
      userId,
      tenantId,
    });

    return { deleted: true };
  }

  // ============================================
  // Public login flow
  // ============================================

  async discoverByEmail(email: string): Promise<{
    available: boolean;
    connectionId?: string;
    name?: string;
    type?: string;
  }> {
    if (!this.configService.get<boolean>('sso.enabled', false)) {
      return { available: false };
    }

    const domain = this.emailDomain(email);
    if (!domain) {
      return { available: false };
    }

    const connections = await this.prisma.ssoConnection.findMany({
      where: { enabled: true },
      select: { id: true, name: true, type: true, allowedEmailDomains: true },
    });

    const match = connections.find((connection) => {
      const allowed = this.toStringArray(connection.allowedEmailDomains);
      return allowed.length === 0 || allowed.includes(domain);
    });

    return match
      ? { available: true, connectionId: match.id, name: match.name, type: match.type }
      : { available: false };
  }

  async beginAuthorization(connectionId: string, redirectPath?: string): Promise<{ url: string }> {
    this.assertEnabled();

    const connection = await this.loadEnabledConnection(connectionId);
    if (connection.type === SAML_PROTOCOL) {
      return this.beginSamlAuthorization(connection, redirectPath);
    }
    return this.beginOidcAuthorization(connection, redirectPath);
  }

  private async beginOidcAuthorization(
    connection: SsoConnectionFields,
    redirectPath?: string,
  ): Promise<{ url: string }> {
    const client = await this.buildOidcClient(connection);

    const state = generators.state();
    const nonce = generators.nonce();
    const codeVerifier = generators.codeVerifier();
    const codeChallenge = generators.codeChallenge(codeVerifier);

    const stored: StoredState = {
      connectionId: connection.id,
      protocol: OIDC,
      codeVerifier,
      nonce,
      redirectPath: this.safeRedirectPath(redirectPath),
    };
    await this.redisService.set(STATE_PREFIX + state, JSON.stringify(stored), this.stateTtl);

    const url = client.authorizationUrl({
      scope: connection.scopes || DEFAULT_SCOPES,
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    return { url };
  }

  private async beginSamlAuthorization(
    connection: SsoConnectionFields,
    redirectPath?: string,
  ): Promise<{ url: string }> {
    const state = randomBytes(32).toString('hex');
    const stored: StoredState = {
      connectionId: connection.id,
      protocol: SAML_PROTOCOL,
      redirectPath: this.safeRedirectPath(redirectPath),
    };
    await this.redisService.set(STATE_PREFIX + state, JSON.stringify(stored), this.stateTtl);

    const saml = this.buildSamlClient(connection);
    const url = await saml.getAuthorizeUrlAsync(state, undefined, {});
    return { url };
  }

  async handleCallback(
    query: Record<string, string | undefined>,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<{ redirectUrl: string }> {
    this.assertEnabled();

    if (query.error) {
      throw new BadRequestException(
        `Identity provider rejected the login: ${query.error_description || query.error}`,
      );
    }

    const state = query.state;
    const code = query.code;
    if (!state || !code) {
      throw new BadRequestException('Missing state or code in SSO callback');
    }

    const stored = await this.consumeState(state);
    if (!stored.codeVerifier || !stored.nonce) {
      throw new UnauthorizedException('SSO state is invalid or has expired');
    }

    const connection = await this.loadEnabledConnection(stored.connectionId);
    const client = await this.buildOidcClient(connection);

    let claims: OidcProfileClaims;
    try {
      const tokenSet = await client.callback(
        this.redirectUri(),
        { code, state },
        {
          state,
          nonce: stored.nonce,
          code_verifier: stored.codeVerifier,
        },
      );
      claims = tokenSet.claims() as unknown as OidcProfileClaims;
    } catch (error) {
      this.logger.warn(
        `OIDC token exchange failed for connection ${connection.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw new UnauthorizedException('SSO token exchange failed');
    }

    return this.completeLogin(connection, this.profileFromOidc(claims), meta);
  }

  async handleSamlResponse(
    body: Record<string, string | undefined>,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<{ redirectUrl: string }> {
    this.assertEnabled();

    const samlResponse = body.SAMLResponse ?? body.SamlResponse;
    if (!samlResponse) {
      throw new BadRequestException('Missing SAMLResponse in assertion consumer service POST');
    }

    const relayState = body.RelayState;
    if (!relayState) {
      throw new UnauthorizedException('Missing RelayState; cannot link the SAML response');
    }

    const stored = await this.consumeState(relayState);
    if (stored.protocol !== SAML_PROTOCOL) {
      throw new UnauthorizedException('SSO state does not match a SAML login');
    }

    const connection = await this.loadEnabledConnection(stored.connectionId);
    if (connection.type !== SAML_PROTOCOL) {
      throw new BadRequestException('This SSO connection is not configured for SAML');
    }

    const saml = this.buildSamlClient(connection);
    let profile: Record<string, unknown>;
    try {
      const result = await saml.validatePostResponseAsync({
        SAMLResponse: samlResponse,
        RelayState: relayState,
      });
      profile = (result.profile ?? {}) as unknown as Record<string, unknown>;
    } catch (error) {
      this.logger.warn(
        `SAML assertion validation failed for connection ${connection.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw new UnauthorizedException('SAML assertion validation failed');
    }

    if (!Object.keys(profile).length) {
      throw new UnauthorizedException('SAML assertion did not contain a profile');
    }

    return this.completeLogin(connection, this.profileFromSaml(profile), meta);
  }

  async samlMetadata(connectionId: string): Promise<string> {
    this.assertEnabled();
    const connection = await this.loadEnabledConnection(connectionId);
    if (connection.type !== SAML_PROTOCOL) {
      throw new BadRequestException('This SSO connection is not configured for SAML');
    }
    return this.buildSamlClient(connection).generateServiceProviderMetadata(null, null);
  }

  async exchangeAuthorizationCode(
    code: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<{ user: AuthUser; tokens: TokenPair }> {
    this.assertEnabled();

    const raw = await this.redisService.get(CODE_PREFIX + code);
    if (!raw) {
      throw new UnauthorizedException('SSO authorization code is invalid or has expired');
    }
    await this.redisService.del(CODE_PREFIX + code);

    const parsed = JSON.parse(raw) as { tokens: TokenPair; userId: string };
    const user = await this.prisma.user.findUnique({
      where: { id: parsed.userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        tenantId: true,
        emailVerified: true,
      },
    });
    if (!user) {
      throw new UnauthorizedException('SSO account no longer exists');
    }

    void meta;
    return { user, tokens: parsed.tokens };
  }

  // ============================================
  // Internals
  // ============================================

  private async consumeState(state: string): Promise<StoredState> {
    const raw = await this.redisService.get(STATE_PREFIX + state);
    if (!raw) {
      throw new UnauthorizedException('SSO state is invalid or has expired');
    }
    // One-time use: consume the state before doing anything else to prevent replay.
    await this.redisService.del(STATE_PREFIX + state);
    return JSON.parse(raw) as StoredState;
  }

  private async completeLogin(
    connection: SsoConnectionFields,
    profile: SsoProfile,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<{ redirectUrl: string }> {
    const user = await this.resolveUser(connection, profile);
    const tokens = await this.authService.issueTokensForUser(user, meta);

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    await this.auditLogsService.log({
      action: 'SSO_LOGIN',
      resource: 'User',
      resourceId: user.id,
      userId: user.id,
      tenantId: connection.tenantId,
      ...meta,
    });

    await this.prisma.ssoConnection.update({
      where: { id: connection.id },
      data: { lastUsedAt: new Date() },
    });

    const exchangeCode = randomBytes(32).toString('hex');
    await this.redisService.set(
      CODE_PREFIX + exchangeCode,
      JSON.stringify({ tokens, userId: user.id }),
      this.exchangeCodeTtl,
    );

    const base = this.configService.get<string>('sso.successRedirectUrl', '');
    const separator = base.includes('?') ? '&' : '?';
    return { redirectUrl: `${base}${separator}code=${exchangeCode}` };
  }

  private profileFromOidc(claims: OidcProfileClaims): SsoProfile {
    return {
      email: claims.email,
      emailVerified: claims.email_verified,
      firstName: claims.given_name,
      lastName: claims.family_name,
      name: claims.name,
    };
  }

  private profileFromSaml(profile: Record<string, unknown>): SsoProfile {
    const email =
      this.firstString(profile, [
        'email',
        'mail',
        'nameID',
        'urn:oid:0.9.2342.19200300.100.1.3',
        'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress',
      ]) ?? undefined;
    return {
      email,
      // SAML assertions reaching this point are signature-validated, so the
      // email is treated as verified by the identity provider.
      emailVerified: true,
      firstName: this.firstString(profile, [
        'firstName',
        'givenName',
        'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname',
      ]),
      lastName: this.firstString(profile, [
        'lastName',
        'surname',
        'familyName',
        'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname',
      ]),
      name: this.firstString(profile, ['displayName', 'name', 'cn']),
    };
  }

  private firstString(source: Record<string, unknown>, keys: string[]): string | undefined {
    for (const key of keys) {
      const value = source[key];
      if (typeof value === 'string' && value.length > 0) {
        return value;
      }
      if (Array.isArray(value) && typeof value[0] === 'string' && value[0].length > 0) {
        return value[0];
      }
    }
    return undefined;
  }

  private assertHttpsUrl(value: string, field: string): void {
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw new BadRequestException(`${field} must be a valid URL`);
    }
    const isLocalhost = ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
    if (parsed.protocol !== 'https:' && !isLocalhost) {
      throw new BadRequestException(`${field} must use https (except localhost)`);
    }
  }

  private async verifyIssuer(issuerUrl: string): Promise<void> {
    this.assertHttpsUrl(issuerUrl, 'issuerUrl');

    try {
      await Issuer.discover(issuerUrl);
    } catch (error) {
      this.logger.warn(
        `OIDC discovery failed for ${issuerUrl}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw new BadRequestException('Unable to reach the OIDC issuer discovery document');
    }
  }

  private async buildOidcClient(connection: SsoConnectionFields): Promise<Client> {
    if (!connection.issuerUrl || !connection.clientId || !connection.clientSecretEncrypted) {
      throw new ServiceUnavailableException('OIDC connection is missing its client configuration');
    }
    const issuer = await Issuer.discover(connection.issuerUrl);
    const clientSecret = decryptSsoSecret(connection.clientSecretEncrypted, this.encryptionKey);
    return new issuer.Client({
      client_id: connection.clientId,
      client_secret: clientSecret,
      redirect_uris: [this.redirectUri()],
      response_types: ['code'],
    });
  }

  private buildSamlClient(connection: SsoConnectionFields): SAML {
    if (!connection.idpSsoUrl || !connection.idpCertificate) {
      throw new ServiceUnavailableException('SAML connection is missing its IdP configuration');
    }
    const spEntityId = this.spEntityId(connection);
    return new SAML({
      entryPoint: connection.idpSsoUrl,
      issuer: spEntityId,
      audience: spEntityId,
      idpCert: connection.idpCertificate,
      idpIssuer: connection.idpEntityId ?? undefined,
      callbackUrl: this.samlAcsUrl(),
      wantAssertionsSigned: true,
      wantAuthnResponseSigned: false,
      validateInResponseTo: ValidateInResponseTo.never,
      acceptedClockSkewMs: 5000,
    });
  }

  private spEntityId(connection: SsoConnectionFields): string {
    return connection.spEntityId || this.samlMetadataUrl();
  }

  private async loadEnabledConnection(connectionId: string): Promise<SsoConnectionFields> {
    const connection = await this.prisma.ssoConnection.findUnique({ where: { id: connectionId } });
    if (!connection || !connection.enabled) {
      throw new NotFoundException('SSO connection not found or disabled');
    }
    return connection as SsoConnectionFields;
  }

  private async resolveUser(
    connection: {
      id: string;
      tenantId: string;
      autoProvision: boolean;
      defaultRole: UserRole;
      allowedEmailDomains: unknown;
      name: string;
    },
    profile: SsoProfile,
  ): Promise<SsoUser> {
    const email = profile.email?.toLowerCase();
    if (!email) {
      throw new BadRequestException('Identity provider did not return an email address');
    }
    if (profile.emailVerified === false) {
      throw new ForbiddenException('The identity provider has not verified this email address');
    }

    this.assertDomainAllowed(connection.allowedEmailDomains, email);

    const existing = await this.prisma.user.findFirst({
      where: { email, tenantId: connection.tenantId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        tenantId: true,
        status: true,
      },
    });

    if (existing) {
      if (existing.status !== 'ACTIVE') {
        throw new ForbiddenException('This account is not active');
      }
      return existing;
    }

    const conflicting = await this.prisma.user.findFirst({
      where: { email, tenantId: { not: connection.tenantId } },
      select: { id: true },
    });
    if (conflicting) {
      throw new ConflictException(
        'This email is already registered under a different tenant. Contact your administrator.',
      );
    }

    if (!connection.autoProvision) {
      throw new ForbiddenException(
        'No account exists for this email. Ask an administrator to invite you first.',
      );
    }

    const password = await bcrypt.hash(randomBytes(32).toString('hex'), BCRYPT_ROUNDS);
    const created = await this.prisma.user.create({
      data: {
        tenantId: connection.tenantId,
        email,
        password,
        firstName: profile.firstName || profile.name?.split(' ')[0] || email.split('@')[0],
        lastName: profile.lastName || profile.name?.split(' ').slice(1).join(' ') || '',
        role: connection.defaultRole,
        emailVerified: true,
        status: 'ACTIVE',
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        tenantId: true,
        status: true,
      },
    });

    await this.auditLogsService.log({
      action: 'SSO_USER_PROVISIONED',
      resource: 'User',
      resourceId: created.id,
      tenantId: connection.tenantId,
      newValues: { email: created.email, connectionId: connection.id },
    });

    return created;
  }

  private assertDomainAllowed(allowed: unknown, email: string): void {
    const domains = this.toStringArray(allowed);
    if (domains.length === 0) {
      return;
    }
    const domain = this.emailDomain(email);
    if (!domain || !domains.includes(domain)) {
      throw new ForbiddenException('Your email domain is not allowed to sign in via this SSO');
    }
  }

  private emailDomain(email: string): string | null {
    const parts = email.toLowerCase().split('@');
    if (parts.length !== 2 || !parts[1]) {
      return null;
    }
    return parts[1];
  }

  private toStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return value
      .filter((item): item is string => typeof item === 'string')
      .map((s) => s.toLowerCase());
  }

  private safeRedirectPath(path?: string): string | undefined {
    if (!path) {
      return undefined;
    }
    if (!path.startsWith('/') || path.startsWith('//')) {
      return undefined;
    }
    return path;
  }

  private sanitize(connection: SsoConnectionFields) {
    return {
      id: connection.id,
      tenantId: connection.tenantId,
      name: connection.name,
      type: connection.type,
      issuerUrl: connection.issuerUrl,
      clientId: connection.clientId,
      scopes: connection.scopes ? connection.scopes.split(' ') : [],
      allowedEmailDomains: this.toStringArray(connection.allowedEmailDomains),
      autoProvision: connection.autoProvision,
      defaultRole: connection.defaultRole,
      enabled: connection.enabled,
      idpEntityId: connection.idpEntityId ?? null,
      idpSsoUrl: connection.idpSsoUrl ?? null,
      spEntityId: connection.spEntityId ?? null,
      hasIdpCertificate: Boolean(connection.idpCertificate),
      hasClientSecret: Boolean(connection.clientSecretEncrypted),
      lastUsedAt: connection.lastUsedAt,
      createdAt: connection.createdAt,
      updatedAt: connection.updatedAt,
    };
  }
}
