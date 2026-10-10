const assert = require('node:assert/strict');
const { existsSync, readdirSync, readFileSync } = require('node:fs');
const { join } = require('node:path');

const migrationsDirectory = join(__dirname, '../../prisma/migrations');

function migrationNames() {
  return readdirSync(migrationsDirectory)
    .filter((name) => existsSync(join(migrationsDirectory, name, 'migration.sql')))
    .sort();
}

async function applyRepositoryMigrations(client, schema) {
  const names = migrationNames();
  await client.query(`CREATE TABLE "_integration_migrations" (migration_name TEXT PRIMARY KEY)`);
  for (const name of names) {
    const sql = readFileSync(join(migrationsDirectory, name, 'migration.sql'), 'utf8')
      .replaceAll('"public"', `"${schema}"`);
    await client.query(sql);
    await client.query('INSERT INTO "_integration_migrations" (migration_name) VALUES ($1)', [name]);
  }
  return names;
}

async function assertLatestMigrationApplied(client, names) {
  const latest = names.at(-1);
  assert.ok(latest, 'repository must contain at least one migration');
  const result = await client.query(
    'SELECT migration_name FROM "_integration_migrations" WHERE migration_name = $1',
    [latest],
  );
  assert.equal(result.rowCount, 1, `latest migration ${latest} was not applied`);
}

module.exports = { applyRepositoryMigrations, assertLatestMigrationApplied };
