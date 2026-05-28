import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const expectedApiKey = process.env.API_KEY?.trim();
    if (!expectedApiKey) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    if (request.header('x-api-key') !== expectedApiKey) {
      throw new UnauthorizedException('invalid API key');
    }

    return true;
  }
}
