import {
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { LoginDto } from './login.dto';
import { ResolveStoreDto } from './resolve-store.dto';
import { PinLoginDto } from './pin-login.dto';
import { RefreshTokenDto } from './refresh-token.dto';
import type { JwtPayload } from './types/jwt-payload.type';

const DEFAULT_PIN_MAX_FAILED_ATTEMPTS = 5;
const DEFAULT_PIN_LOCK_DURATION_MINUTES = 15;
const DEFAULT_REFRESH_TOKEN_TTL_DAYS = 30;
const ACCESS_TOKEN_EXPIRES_IN_SECONDS = 24 * 60 * 60;

type PinFailureResult = {
  failedAttempts: number;
  lockedUntil: Date | null;
} | null;

@Injectable()
export class AuthService {
  private readonly pinMaxFailedAttempts: number;
  private readonly pinLockDurationMs: number;
  private readonly refreshTokenTtlMs: number;

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    configService: ConfigService,
  ) {
    this.pinMaxFailedAttempts = this.positiveIntegerConfig(
      configService,
      'PIN_MAX_FAILED_ATTEMPTS',
      DEFAULT_PIN_MAX_FAILED_ATTEMPTS,
    );
    this.pinLockDurationMs =
      this.positiveIntegerConfig(
        configService,
        'PIN_LOCK_DURATION_MINUTES',
        DEFAULT_PIN_LOCK_DURATION_MINUTES,
      ) *
      60 *
      1000;
    this.refreshTokenTtlMs =
      this.positiveIntegerConfig(
        configService,
        'REFRESH_TOKEN_TTL_DAYS',
        DEFAULT_REFRESH_TOKEN_TTL_DAYS,
      ) *
      24 *
      60 *
      60 *
      1000;
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.users.findUnique({
      where: {
        tenant_id_email: {
          tenant_id: dto.tenant_id,
          email: dto.email,
        },
      },
    });

    if (!user || !user.is_active) {
      throw new UnauthorizedException('Email atau password salah');
    }

    const passwordValid = await bcrypt.compare(
      dto.password,
      user.password_hash,
    );

    if (!passwordValid) {
      throw new UnauthorizedException('Email atau password salah');
    }

    const payload = {
      sub: user.id,
      tenant_id: user.tenant_id,
      role: user.role,
      outlet_id: user.outlet_id,
    };

    return {
      access_token: this.jwtService.sign(payload),
    };
  }

  async resolveStore(dto: ResolveStoreDto) {
    const tenant = await this.prisma.tenants.findFirst({
      where: {
        store_code: dto.store_code,
        is_active: true,
      },
      select: {
        id: true,
        name: true,
        users: {
          where: {
            is_active: true,
          },
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            name: true,
            role: true,
            outlet_id: true,
          },
        },
      },
    });

    if (!tenant) {
      throw new NotFoundException({
        error_code: 'STORE_NOT_FOUND',
        message: 'Store not found',
      });
    }

    return {
      tenant: {
        id: tenant.id,
        name: tenant.name,
      },
      users: tenant.users,
    };
  }

  async pinLogin(dto: PinLoginDto) {
    const tenantId = dto.tenant_id.toLowerCase();
    const userId = dto.user_id.toLowerCase();
    const now = new Date();
    const user = await this.prisma.users.findFirst({
      where: {
        id: userId,
        tenant_id: tenantId,
        is_active: true,
        tenants: {
          is_active: true,
        },
      },
      select: {
        id: true,
        tenant_id: true,
        role: true,
        outlet_id: true,
        pin_hash: true,
        locked_until: true,
      },
    });

    if (!user?.pin_hash) {
      throw this.invalidPinCredentials();
    }

    if (user.locked_until && user.locked_until > now) {
      throw this.pinLocked(user.locked_until, now);
    }

    const pinValid = await bcrypt.compare(dto.pin, user.pin_hash);
    if (!pinValid) {
      const failure = await this.recordFailedPin(
        user.id,
        user.tenant_id,
        user.pin_hash,
        now,
      );
      if (!failure) {
        throw this.invalidPinCredentials();
      }
      if (failure.lockedUntil) {
        throw this.pinLocked(failure.lockedUntil, now);
      }
      throw this.invalidPinCredentials();
    }

    const refreshToken = this.newRefreshToken();
    const refreshTokenHash = this.hashRefreshToken(refreshToken);
    const expiresAt = new Date(now.getTime() + this.refreshTokenTtlMs);
    const sessionCreated = await this.prisma.$transaction(async (tx) => {
      const current = await tx.users.findFirst({
        where: {
          id: user.id,
          tenant_id: user.tenant_id,
          is_active: true,
          pin_hash: user.pin_hash,
          tenants: {
            is_active: true,
          },
        },
        select: { id: true },
      });
      if (!current) {
        return false;
      }
      const reset = await tx.users.updateMany({
        where: {
          id: user.id,
          tenant_id: user.tenant_id,
          is_active: true,
          pin_hash: user.pin_hash,
        },
        data: {
          pin_failed_attempts: 0,
          locked_until: null,
        },
      });
      if (reset.count !== 1) {
        return false;
      }
      await tx.device_sessions.create({
        data: {
          tenant_id: user.tenant_id,
          user_id: user.id,
          device_id: dto.device_id.toLowerCase(),
          device_name: dto.device_name?.trim() || null,
          refresh_token_hash: refreshTokenHash,
          status: 'ACTIVE',
          created_at: now,
          last_used_at: now,
          expires_at: expiresAt,
        },
      });
      return true;
    });
    if (!sessionCreated) {
      throw this.invalidPinCredentials();
    }

    return this.tokenResponse(user, refreshToken);
  }

  async refresh(dto: RefreshTokenDto) {
    const now = new Date();
    const currentTokenHash = this.hashRefreshToken(dto.refresh_token);
    const nextToken = this.newRefreshToken();
    const nextTokenHash = this.hashRefreshToken(nextToken);
    const nextExpiresAt = new Date(now.getTime() + this.refreshTokenTtlMs);

    const user = await this.prisma.$transaction(async (tx) => {
      const session = await tx.device_sessions.findFirst({
        where: { refresh_token_hash: currentTokenHash },
        select: {
          id: true,
          tenant_id: true,
          user_id: true,
          device_id: true,
          device_name: true,
          status: true,
          expires_at: true,
          users: {
            select: {
              id: true,
              tenant_id: true,
              role: true,
              outlet_id: true,
              is_active: true,
            },
          },
          tenants: {
            select: { is_active: true },
          },
        },
      });
      if (!session) {
        return null;
      }

      const usable =
        session.status === 'ACTIVE' &&
        session.expires_at > now &&
        session.users.is_active &&
        session.tenants.is_active;
      if (!usable) {
        if (session.status === 'ACTIVE') {
          await tx.device_sessions.updateMany({
            where: {
              id: session.id,
              tenant_id: session.tenant_id,
              refresh_token_hash: currentTokenHash,
              status: 'ACTIVE',
            },
            data: {
              status: 'REVOKED',
              revoked_at: now,
              last_used_at: now,
            },
          });
        }
        return null;
      }

      const revoked = await tx.device_sessions.updateMany({
        where: {
          id: session.id,
          tenant_id: session.tenant_id,
          user_id: session.user_id,
          refresh_token_hash: currentTokenHash,
          status: 'ACTIVE',
        },
        data: {
          status: 'REVOKED',
          revoked_at: now,
          rotated_at: now,
          last_used_at: now,
        },
      });
      if (revoked.count !== 1) {
        return null;
      }

      await tx.device_sessions.create({
        data: {
          tenant_id: session.tenant_id,
          user_id: session.user_id,
          device_id: session.device_id,
          device_name: session.device_name,
          refresh_token_hash: nextTokenHash,
          status: 'ACTIVE',
          created_at: now,
          last_used_at: now,
          expires_at: nextExpiresAt,
        },
      });

      return session.users;
    });

    if (!user) {
      throw this.invalidRefreshToken();
    }
    return this.tokenResponse(user, nextToken);
  }

  async logout(dto: RefreshTokenDto): Promise<void> {
    const refreshTokenHash = this.hashRefreshToken(dto.refresh_token);
    const session = await this.prisma.device_sessions.findFirst({
      where: { refresh_token_hash: refreshTokenHash },
      select: { id: true, tenant_id: true },
    });
    if (!session) {
      return;
    }

    await this.prisma.device_sessions.updateMany({
      where: {
        id: session.id,
        tenant_id: session.tenant_id,
        refresh_token_hash: refreshTokenHash,
        status: 'ACTIVE',
      },
      data: {
        status: 'REVOKED',
        revoked_at: new Date(),
      },
    });
  }

  async getCurrentUser(user: JwtPayload) {
    const currentUser = await this.prisma.users.findFirst({
      where: {
        id: user.sub,
        tenant_id: user.tenant_id,
        is_active: true,
        tenants: {
          is_active: true,
        },
      },
      select: {
        id: true,
        name: true,
        role: true,
        tenant_id: true,
        outlet_id: true,
      },
    });

    if (!currentUser) {
      throw new UnauthorizedException({
        error_code: 'CURRENT_USER_UNAVAILABLE',
        message: 'Current user is unavailable',
      });
    }

    return currentUser;
  }

  private async recordFailedPin(
    userId: string,
    tenantId: string,
    expectedPinHash: string,
    failedAt: Date,
  ): Promise<PinFailureResult> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            const current = await tx.users.findFirst({
              where: {
                id: userId,
                tenant_id: tenantId,
                is_active: true,
                pin_hash: expectedPinHash,
              },
              select: {
                pin_failed_attempts: true,
                locked_until: true,
              },
            });
            if (!current) {
              return null;
            }
            if (current.locked_until && current.locked_until > failedAt) {
              return {
                failedAttempts: current.pin_failed_attempts,
                lockedUntil: current.locked_until,
              };
            }

            const previousAttempts =
              current.locked_until && current.locked_until <= failedAt
                ? 0
                : current.pin_failed_attempts;
            const failedAttempts = previousAttempts + 1;
            const lockedUntil =
              failedAttempts >= this.pinMaxFailedAttempts
                ? new Date(failedAt.getTime() + this.pinLockDurationMs)
                : null;
            const result = await tx.users.updateMany({
              where: {
                id: userId,
                tenant_id: tenantId,
                is_active: true,
                pin_hash: expectedPinHash,
              },
              data: {
                pin_failed_attempts: failedAttempts,
                locked_until: lockedUntil,
              },
            });
            if (result.count !== 1) {
              return null;
            }
            return { failedAttempts, lockedUntil };
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2034'
        ) {
          if (attempt < 2) {
            continue;
          }
          break;
        }
        throw error;
      }
    }

    throw new ServiceUnavailableException({
      error_code: 'PIN_LOGIN_RETRY_REQUIRED',
      message: 'PIN login changed concurrently; please retry',
    });
  }

  private invalidPinCredentials(): UnauthorizedException {
    return new UnauthorizedException({
      error_code: 'INVALID_CREDENTIALS',
      message: 'User or PIN is invalid',
    });
  }

  private invalidRefreshToken(): UnauthorizedException {
    return new UnauthorizedException({
      error_code: 'INVALID_REFRESH_TOKEN',
      message: 'Refresh token is invalid or expired',
    });
  }

  private newRefreshToken(): string {
    return randomBytes(48).toString('base64url');
  }

  private hashRefreshToken(refreshToken: string): string {
    return createHash('sha256').update(refreshToken, 'utf8').digest('hex');
  }

  private tokenResponse(
    user: {
      id: string;
      tenant_id: string;
      role: string;
      outlet_id: string | null;
    },
    refreshToken: string,
  ) {
    return {
      access_token: this.jwtService.sign({
        sub: user.id,
        tenant_id: user.tenant_id,
        role: user.role,
        outlet_id: user.outlet_id,
      }),
      refresh_token: refreshToken,
      expires_in: ACCESS_TOKEN_EXPIRES_IN_SECONDS,
    };
  }

  private pinLocked(lockedUntil: Date, now: Date): HttpException {
    return new HttpException(
      {
        error_code: 'PIN_LOCKED',
        message: 'PIN login is temporarily locked',
        retry_after_seconds: Math.max(
          1,
          Math.ceil((lockedUntil.getTime() - now.getTime()) / 1000),
        ),
      },
      HttpStatus.LOCKED,
    );
  }

  private positiveIntegerConfig(
    configService: ConfigService,
    key: string,
    fallback: number,
  ): number {
    const configured = configService.get<string | number>(key);
    if (configured == null || configured === '') {
      return fallback;
    }
    const value = Number(configured);
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`${key} must be a positive integer`);
    }
    return value;
  }
}
