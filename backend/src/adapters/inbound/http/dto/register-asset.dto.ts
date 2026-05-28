import { IsString, Matches } from 'class-validator';

export class RegisterAssetDto {
  @IsString()
  @Matches(/^[1-9]\d*$/, { message: 'assetId must be a positive base-10 integer' })
  assetId!: string;
}
