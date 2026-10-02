import {
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { USER_ROLES } from '@tablofy/shared/constants';

const DOMAIN_PATTERN = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/i;

export class CreateSsoConnectionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @IsOptional()
  @IsIn(['OIDC', 'SAML'])
  type?: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  @MaxLength(2048)
  issuerUrl?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  clientId?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(1024)
  clientSecret?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(2048)
  idpEntityId?: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  @MaxLength(2048)
  idpSsoUrl?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(8192)
  idpCertificate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  spEntityId?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  scopes?: string[];

  @IsOptional()
  @IsArray()
  @Matches(DOMAIN_PATTERN, {
    each: true,
    message: 'each allowedEmailDomains entry must be a domain',
  })
  allowedEmailDomains?: string[];

  @IsOptional()
  @IsBoolean()
  autoProvision?: boolean;

  @IsOptional()
  @IsIn(Object.values(USER_ROLES))
  defaultRole?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
