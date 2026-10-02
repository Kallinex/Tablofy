import { PartialType } from '@nestjs/swagger';
import { CreateSsoConnectionDto } from './create-sso-connection.dto';

export class UpdateSsoConnectionDto extends PartialType(CreateSsoConnectionDto) {}
