import { IsNotEmpty, IsString } from 'class-validator';

export class FileDto {
  @IsString()
  @IsNotEmpty({ message: 'fileURI is required' })
  fileURI!: string;

  @IsString()
  @IsNotEmpty({ message: 'fileHash is required' })
  fileHash!: string;
}
