const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const { Client } = require('pg');

// Use an explicitly supplied disposable database. Never falls back to DATABASE_URL.
const url = process.env.MIGRATION_TEST_DATABASE_URL;
const baseline = readFileSync(join(__dirname, '../migrations/20260914000000_baseline/migration.sql'), 'utf8');
const migration = readFileSync(join(__dirname, '../migrations/20260914000100_transaction_tenant_integrity/migration.sql'), 'utf8');

async function withSchema(run) {
    const schema = `migration_${randomUUID().replaceAll('-', '')}`;
    const db = new Client({ connectionString: url });
    await db.connect();
    try {
        await db.query(`CREATE SCHEMA "${schema}"`);
        await db.query(`SET search_path TO "${schema}"`);
        await db.query(baseline.replaceAll('"public"', `"${schema}"`));
        await run(db, schema);
    } finally {
        await db.query('ROLLBACK');
        await db.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await db.end();
    }
}

async function seed(db) {
    const a = randomUUID(), b = randomUUID();
    const outlet = randomUUID(), otherOutlet = randomUUID();
    const user = randomUUID(), otherUser = randomUUID();
    const product = randomUUID(), otherProduct = randomUUID();
    const transaction = randomUUID(), item = randomUUID(), payment = randomUUID(), clientId = randomUUID();
    await db.query('INSERT INTO tenants(id,name) VALUES($1,\'A\'),($2,\'B\')', [a, b]);
    await db.query('INSERT INTO outlets(id,tenant_id,name) VALUES($1,$2,\'A\'),($3,$4,\'B\')', [outlet,a,otherOutlet,b]);
    await db.query("INSERT INTO users(id,tenant_id,name,email,password_hash,role) VALUES($1,$2,'A','a@test','fixture','OWNER'),($3,$4,'B','b@test','fixture','OWNER')", [user,a,otherUser,b]);
    await db.query("INSERT INTO products(id,tenant_id,name,sku) VALUES($1,$2,'A','A'),($3,$4,'B','B')", [product,a,otherProduct,b]);
    await db.query("INSERT INTO transactions(id,tenant_id,outlet_id,user_id,client_transaction_id,status,subtotal,total,created_at) VALUES($1,$2,$3,$4,$5,'COMPLETED',200,200,'2026-01-01T00:00:00Z')", [transaction,a,outlet,user,clientId]);
    await db.query('INSERT INTO transaction_items(id,transaction_id,product_id,quantity,unit_price,unit_cost,subtotal) VALUES($1,$2,$3,2,100,50,200)', [item,transaction,product]);
    await db.query("INSERT INTO payments(id,transaction_id,method,status,amount,paid_at,created_at) VALUES($1,$2,'CASH','PAID',300,'2026-01-01T00:01:00Z','2026-01-01T00:01:00Z')", [payment,transaction]);
    return {a,b,outlet,otherOutlet,user,otherUser,product,otherProduct,transaction,item,payment,clientId};
}

async function rejected(db, sql, args, code) {
    await assert.rejects(db.query(sql,args), (e) => e.code === code);
}

test('transaction database migrations', { skip: !url }, async (t) => {
    await t.test('optional tax migration preserves existing rate and disables tax by default', () => withSchema(async (db) => {
        const x = await seed(db);
        await db.query('UPDATE tenants SET tax_rate=11 WHERE id=$1', [x.a]);
        await db.query(migration);
        await db.query(readFileSync(join(__dirname, '../migrations/20260915000000_optional_tenant_tax/migration.sql'), 'utf8'));
        const tenant = (await db.query('SELECT tax_rate,tax_enabled,tax_included FROM tenants WHERE id=$1', [x.a])).rows[0];
        assert.equal(tenant.tax_rate, '11.00');
        assert.equal(tenant.tax_enabled, false);
        assert.equal(tenant.tax_included, false);
        assert.equal((await db.query('SELECT total FROM transactions WHERE id=$1', [x.transaction])).rows[0].total, '200');
    }));

    await t.test('baseline and migration apply on an empty schema', () => withSchema(async (db) => {
        await db.query(migration);
        assert.equal((await db.query('SELECT count(*) FROM transactions')).rows[0].count, '0');
    }));

    await t.test('existing data is preserved and child tenant/timestamps are backfilled', () => withSchema(async (db) => {
        const ids = await seed(db);
        await db.query(migration);
        const item = (await db.query('SELECT * FROM transaction_items WHERE id=$1', [ids.item])).rows[0];
        const payment = (await db.query('SELECT * FROM payments WHERE id=$1', [ids.payment])).rows[0];
        assert.equal(item.tenant_id, ids.a);
        assert.equal(item.subtotal, '200');
        assert.equal(item.created_at.toISOString(), '2026-01-01T00:00:00.000Z');
        assert.equal(payment.tenant_id, ids.a);
        assert.equal(payment.status, 'PAID');
        assert.equal(payment.amount, '300');
        assert.equal(payment.updated_at.toISOString(), payment.created_at.toISOString());
        assert.equal((await db.query('SELECT status FROM transactions WHERE id=$1',[ids.transaction])).rows[0].status,'COMPLETED');
    }));

    await t.test('database rejects cross-tenant references and missing tenant IDs', () => withSchema(async (db) => {
        const x = await seed(db); await db.query(migration);
        await rejected(db, 'UPDATE transactions SET outlet_id=$1 WHERE id=$2', [x.otherOutlet,x.transaction], '23503');
        await rejected(db, 'UPDATE transactions SET user_id=$1 WHERE id=$2', [x.otherUser,x.transaction], '23503');
        await rejected(db, 'UPDATE transaction_items SET product_id=$1 WHERE id=$2', [x.otherProduct,x.item], '23503');
        await rejected(db, 'UPDATE transaction_items SET tenant_id=$1 WHERE id=$2', [x.b,x.item], '23503');
        await rejected(db, 'UPDATE payments SET tenant_id=$1 WHERE id=$2', [x.b,x.payment], '23503');
        await rejected(db, 'UPDATE payments SET tenant_id=NULL WHERE id=$1', [x.payment], '23502');
        await rejected(db, 'UPDATE transaction_items SET tenant_id=NULL WHERE id=$1', [x.item], '23502');
    }));

    await t.test('amount, quantity, status and arithmetic constraints are enforced', () => withSchema(async (db) => {
        const x = await seed(db); await db.query(migration);
        await rejected(db, 'UPDATE transactions SET total=199 WHERE id=$1', [x.transaction], '23514');
        await rejected(db, 'UPDATE transaction_items SET subtotal=199 WHERE id=$1', [x.item], '23514');
        await rejected(db, 'UPDATE transaction_items SET quantity=0 WHERE id=$1', [x.item], '23514');
        await rejected(db, 'UPDATE transaction_items SET unit_cost=-1 WHERE id=$1', [x.item], '23514');
        await rejected(db, 'UPDATE payments SET amount=0 WHERE id=$1', [x.payment], '23514');
        await rejected(db, "UPDATE transactions SET status='PAID' WHERE id=$1", [x.transaction], '23514');
        await rejected(db, "UPDATE payments SET status='SUCCESS' WHERE id=$1", [x.payment], '23514');
        await db.query('UPDATE transactions SET discount=20,tax=10,total=190 WHERE id=$1',[x.transaction]);
        await db.query('UPDATE transaction_items SET unit_price=4503599627370496,subtotal=9007199254740992 WHERE id=$1',[x.item]);
    }));

    await t.test('client transaction ID is unique per tenant', () => withSchema(async (db) => {
        const x = await seed(db); await db.query(migration);
        const sql = 'INSERT INTO transactions(tenant_id,outlet_id,user_id,client_transaction_id) VALUES($1,$2,$3,$4)';
        await rejected(db, sql, [x.a,x.outlet,x.user,x.clientId], '23505');
        await db.query(sql, [x.b,x.otherOutlet,x.otherUser,x.clientId]);
    }));

    for (const scenario of ['foreign outlet', 'foreign product', 'invalid total', 'invalid item subtotal']) {
        await t.test(`legacy ${scenario} aborts migration without partial schema/data changes`, () => withSchema(async (db,schema) => {
            const x = await seed(db);
            if(scenario==='foreign outlet') await db.query('UPDATE transactions SET outlet_id=$1 WHERE id=$2',[x.otherOutlet,x.transaction]);
            if(scenario==='foreign product') await db.query('UPDATE transaction_items SET product_id=$1 WHERE id=$2',[x.otherProduct,x.item]);
            if(scenario==='invalid total') await db.query('UPDATE transactions SET total=199 WHERE id=$1',[x.transaction]);
            if(scenario==='invalid item subtotal') await db.query('UPDATE transaction_items SET subtotal=199 WHERE id=$1',[x.item]);
            await assert.rejects(db.query(migration));
            await db.query('ROLLBACK');
            const columns = await db.query("SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name='payments' AND column_name='tenant_id'",[schema]);
            assert.equal(columns.rowCount,0);
            assert.equal((await db.query('SELECT count(*) FROM transaction_items')).rows[0].count,'1');
            assert.equal((await db.query('SELECT count(*) FROM payments')).rows[0].count,'1');
            const constraints = await db.query("SELECT 1 FROM pg_constraint WHERE conrelid='payments'::regclass AND conname='fk_payments_transaction'");
            assert.equal(constraints.rowCount,1);
        }));
    }
});
