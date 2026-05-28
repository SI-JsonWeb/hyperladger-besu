import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';

@Injectable()
export class ParsePositiveBigIntPipe implements PipeTransform<string, bigint> {
  transform(value: string): bigint {
    if (!/^\d+$/.test(value.trim())) {
      throw new BadRequestException('asset id must be a positive base-10 integer');
    }

    const parsed = BigInt(value.trim());
    if (parsed <= 0n) {
      throw new BadRequestException('asset id must be a positive base-10 integer');
    }

    return parsed;
  }
}
