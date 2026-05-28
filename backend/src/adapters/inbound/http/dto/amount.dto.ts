import { IsString, Matches } from 'class-validator';

export class AmountDto {
  @IsString()
  @Matches(/^[1-9]\d*$/, { message: 'amountWei must be a positive base-10 integer' })
  amountWei!: string;
}
