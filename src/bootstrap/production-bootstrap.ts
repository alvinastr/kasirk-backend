#!/usr/bin/env node
import { NestFactory } from '@nestjs/core';
import { ProductionBootstrapModule } from './production-bootstrap.module';
import { ProductionBootstrapService } from './production-bootstrap.service';
import type { BootstrapInputs } from './production-bootstrap.service';

async function bootstrap() {
  const requiredEnvVars = [
    'BOOTSTRAP_STORE_CODE',
    'BOOTSTRAP_TENANT_NAME',
    'BOOTSTRAP_OUTLET_NAME',
    'BOOTSTRAP_OWNER_NAME',
    'BOOTSTRAP_OWNER_EMAIL',
    'BOOTSTRAP_OWNER_PASSWORD',
    'BOOTSTRAP_OWNER_PIN',
  ];

  const missing = requiredEnvVars.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    console.error(`Missing required environment variables: ${missing.join(', ')}`);
    process.exit(1);
  }

  let app;
  try {
    app = await NestFactory.createApplicationContext(ProductionBootstrapModule, {
      logger: false,
    });

    const service = app.get(ProductionBootstrapService);

    const inputs: BootstrapInputs = {
      storeCode: process.env.BOOTSTRAP_STORE_CODE!,
      tenantName: process.env.BOOTSTRAP_TENANT_NAME!,
      tenantAddress: process.env.BOOTSTRAP_TENANT_ADDRESS,
      outletName: process.env.BOOTSTRAP_OUTLET_NAME!,
      outletAddress: process.env.BOOTSTRAP_OUTLET_ADDRESS,
      ownerName: process.env.BOOTSTRAP_OWNER_NAME!,
      ownerEmail: process.env.BOOTSTRAP_OWNER_EMAIL!,
      ownerPassword: process.env.BOOTSTRAP_OWNER_PASSWORD!,
      ownerPin: process.env.BOOTSTRAP_OWNER_PIN!,
    };

    const result = await service.bootstrap(inputs);

    console.log('Production bootstrap successful:');
    console.log(`  Tenant ID:    ${result.tenantId}`);
    console.log(`  Store Code:   ${result.storeCode}`);
    console.log(`  Outlet ID:    ${result.outletId}`);
    console.log(`  OWNER ID:     ${result.ownerId}`);
    console.log(`  OWNER Email:  ${result.ownerEmail}`);

    await app.close();
    process.exit(0);
  } catch (error) {
    if (app) {
      await app.close();
    }

    if (
      error instanceof Error &&
      error.message === 'Production bootstrap refused: business data already exists'
    ) {
      console.error(error.message);
      process.exit(1);
    }

    console.error('Production bootstrap failed:', error instanceof Error ? error.message : 'Unknown error');
    process.exit(1);
  }
}

bootstrap();
