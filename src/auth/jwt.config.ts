import { ConfigService } from '@nestjs/config';

export function getJwtSecret(configService: ConfigService): string {
  const secret = configService.get<string>('JWT_SECRET');
  if (!secret?.trim()) {
    throw new Error('JWT_SECRET is required');
  }
  return secret;
}
