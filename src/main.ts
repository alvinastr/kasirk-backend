import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
    }),
  );

  // Documentation is opt-in so production does not expose API metadata by default.
  if (process.env.ENABLE_SWAGGER_DOCS === 'true') {
    const packageJson = JSON.parse(
      readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'),
    );

    const config = new DocumentBuilder()
      .setTitle('KasirKita API')
      .setDescription(
        'Multi-tenant Point of Sale (POS) backend API for KasirKita.\n\n' +
        'Features:\n' +
        '- Multi-tenant architecture with tenant isolation\n' +
        '- JWT authentication with role-based access control (OWNER, ADMIN, CASHIER)\n' +
        '- Product and category management\n' +
        '- Multi-outlet inventory and stock management\n' +
        '- Transaction processing with idempotency protection\n' +
        '- Customer management\n' +
        '- Shift management for cashiers\n' +
        '- Sales reports and analytics\n' +
        '- Offline transaction sync\n\n' +
        'All authenticated endpoints require a valid JWT Bearer token.',
      )
      .setVersion(packageJson.version || '1.0.0')
      .addBearerAuth(
        {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Enter JWT access token obtained from /auth/login or /auth/v2/pin/login',
        },
        'JWT',
      )
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('docs', app, document, {
      swaggerOptions: {
        persistAuthorization: false,
      },
    });
  }

  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
}

bootstrap();