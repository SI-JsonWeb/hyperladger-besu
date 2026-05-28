import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class VerifyFileDto {
  @IsOptional()
  @IsString()
  fileURI?: string;

  @IsString()
  @IsNotEmpty({ message: 'fileHash is required' })
  fileHash!: string;
}
