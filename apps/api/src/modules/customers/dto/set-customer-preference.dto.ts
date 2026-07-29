import { IsString, MaxLength } from 'class-validator';

export class SetCustomerPreferenceDto {
  @IsString()
  @MaxLength(100)
  key!: string;

  @IsString()
  value!: string;
}
