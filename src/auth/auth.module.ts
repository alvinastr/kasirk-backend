import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { PrismaModule } from '../prisma/prisma.module';
import { JwtStrategy } from './jwt.strategy';
import { RolesGuard } from '../common/guards/roles.guard';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { getJwtSecret } from './jwt.config';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,

    PassportModule.register({
      defaultStrategy: 'jwt',
    }),

    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: getJwtSecret(configService),
        signOptions: {
          expiresIn: '1d',
        },
      }),
    }),
  ],

  controllers: [AuthController],

  providers: [AuthService, JwtStrategy, RolesGuard],

  exports: [PassportModule, JwtModule, RolesGuard],
})
export class AuthModule {}
