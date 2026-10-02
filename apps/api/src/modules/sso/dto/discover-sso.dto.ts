import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class DiscoverSsoQueryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(320)
  @Matches(/@/, { message: 'email must contain an @' })
  email!: string;
}
