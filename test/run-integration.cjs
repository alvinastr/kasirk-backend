const { randomBytes } = require('node:crypto');
const { existsSync } = require('node:fs');
const { spawnSync } = require('node:child_process');

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
if (!testDatabaseUrl) {
  console.error('TEST_DATABASE_URL is required for integration tests');
  process.exit(1);
}

const testFiles = [
  'prisma/tests/transaction-migration.test.cjs',
  'test/auth.integration.cjs',
  'test/customers.integration.cjs',
  'test/device-session.integration.cjs',
  'test/hardening.integration.ts',
  'test/optional-stock.integration.cjs',
  'test/pin-login.integration.cjs',
  'test/product-category.integration.cjs',
  'test/rbac.integration.cjs',
  'test/receipts.integration.cjs',
  'test/reports.integration.cjs',
  'test/shifts.integration.cjs',
  'test/sync.integration.cjs',
  'test/transactions-http.integration.cjs',
  'test/transactions-service.integration.cjs',
  'test/user-pin.integration.cjs',
];

const missingFiles = testFiles.filter((file) => !existsSync(file));
if (missingFiles.length > 0) {
  console.error(`Integration test files not found: ${missingFiles.join(', ')}`);
  process.exit(1);
}

const databaseVariables = [
  'DATABASE_URL',
  'CUSTOMER_TEST_DATABASE_URL',
  'DEVICE_SESSION_TEST_DATABASE_URL',
  'HARDENING_DATABASE_URL',
  'MIGRATION_TEST_DATABASE_URL',
  'OPTIONAL_STOCK_TEST_DATABASE_URL',
  'PIN_LOGIN_TEST_DATABASE_URL',
  'PRODUCT_CATEGORY_TEST_DATABASE_URL',
  'RECEIPT_TEST_DATABASE_URL',
  'SHIFT_TEST_DATABASE_URL',
  'SYNC_TEST_DATABASE_URL',
  'TRANSACTION_TEST_DATABASE_URL',
  'USER_PIN_TEST_DATABASE_URL',
];

const childEnvironment = {
  ...process.env,
  JWT_SECRET: `phase1-integration-${randomBytes(32).toString('hex')}`,
  NODE_ENV: 'test',
  TS_NODE_PROJECT: 'test/tsconfig.hardening.json',
};
for (const variable of databaseVariables) {
  childEnvironment[variable] = testDatabaseUrl;
}

const result = spawnSync(
  process.execPath,
  [
    '--require',
    'ts-node/register/transpile-only',
    '--test',
    '--test-concurrency=1',
    ...testFiles,
  ],
  {
    cwd: process.cwd(),
    env: childEnvironment,
    stdio: 'inherit',
  },
);

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
