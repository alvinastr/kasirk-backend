// TS_NODE_PROJECT=test/tsconfig.hardening.json TRANSACTION_TEST_DATABASE_URL=... node --require ts-node/register/transpile-only --test test/transactions-http.integration.cjs
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const { Client } = require('pg');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Test } = require('@nestjs/testing');
const { ValidationPipe } = require('@nestjs/common');
const { JwtService } = require('@nestjs/jwt');
const request = require('supertest');
const { AppModule } = require('../src/app.module');
const { PrismaService } = require('../src/prisma/prisma.service');

test('Transactions HTTP endpoints with real JWT guard and database', {skip: !process.env.TRANSACTION_TEST_DATABASE_URL}, async t => {
    const connectionString = process.env.TRANSACTION_TEST_DATABASE_URL;
    const schema = `http_${randomUUID().replaceAll('-','')}`;
    const admin = new Client({connectionString});
    await admin.connect();
    let db, app;
    try {
        await admin.query(`CREATE SCHEMA "${schema}"`);
        await admin.query(`SET search_path TO "${schema}"`);
        for(const name of ['20260914000000_baseline','20260914000100_transaction_tenant_integrity','20260915000000_optional_tenant_tax','20260915010000_add_customers','20260915020000_add_cashier_sessions']) {
            await admin.query(readFileSync(join(__dirname,'../prisma/migrations',name,'migration.sql'),'utf8').replaceAll('"public"',`"${schema}"`));
        }
        db = new PrismaClient({adapter:new PrismaPg({connectionString},{schema})});
        const module = await Test.createTestingModule({imports:[AppModule]}).overrideProvider(PrismaService).useValue(db).compile();
        app=module.createNestApplication();
        app.useGlobalPipes(new ValidationPipe({whitelist:true}));
        await app.init();
        const http=request(app.getHttpServer());
        const jwt=module.get(JwtService);
        const a=await db.tenants.create({data:{name:'A'}}), b=await db.tenants.create({data:{name:'B'}});
        const oa=await db.outlets.create({data:{tenant_id:a.id,name:'A1'}}), oa2=await db.outlets.create({data:{tenant_id:a.id,name:'A2'}}), ob=await db.outlets.create({data:{tenant_id:b.id,name:'B'}});
        const owner=await db.users.create({data:{tenant_id:a.id,name:'Owner',email:'owner@test',password_hash:'fixture',role:'OWNER'}});
        const ownerB=await db.users.create({data:{tenant_id:b.id,name:'Other',email:'other@test',password_hash:'fixture',role:'OWNER'}});
        const cashier=await db.users.create({data:{tenant_id:a.id,outlet_id:oa.id,name:'Cashier',email:'cashier@test',password_hash:'fixture',role:'CASHIER'}});
        const token=u=>jwt.sign({sub:u.id,tenant_id:u.tenant_id,role:u.role});
        const auth=token(owner), authB=token(ownerB), cashAuth=token(cashier);
        const product=await db.products.create({data:{tenant_id:a.id,name:'Product',sku:'P',price:100,cost:50}});
        await db.product_stocks.create({data:{outlet_id:oa.id,product_id:product.id,stock:20}});
        const body=()=>({client_transaction_id:randomUUID(),outlet_id:oa.id,items:[{product_id:product.id,quantity:2}],payment:{method:'CASH',amount:500}});
        const seed=async(tenant,outlet,user,status,date)=>db.transactions.create({data:{tenant_id:tenant.id,outlet_id:outlet.id,user_id:user.id,client_transaction_id:randomUUID(),status,created_at:new Date(date)}});
        const pending=await seed(a,oa,owner,'PENDING','2026-01-01T00:00:00Z');
        const voided=await seed(a,oa2,owner,'VOID','2026-01-02T00:00:00Z');
        const foreign=await seed(b,ob,ownerB,'CANCELLED','2026-01-03T00:00:00Z');
        const get=(path,authorization=auth)=>http.get(path).set('Authorization',`Bearer ${authorization}`);

        await t.test('all routes reject missing, invalid and expired tokens',async()=>{
            for(const path of ['/transactions',`/transactions/${pending.id}`]){
                await http.get(path).expect(401);await get(path,'bad-token').expect(401);
            }
            await http.post('/transactions').send(body()).expect(401);
            const expired=jwt.sign({sub:owner.id,tenant_id:a.id,role:'OWNER'},{expiresIn:-1});
            await get('/transactions',expired).expect(401);
        });
        await t.test('POST creates CASH checkout through CurrentUser and nested DTO',async()=>{
            const payload=body();const r=await http.post('/transactions').set('Authorization',`Bearer ${auth}`).send(payload).expect(201);
            assert.equal(r.body.status,'COMPLETED');assert.equal(r.body.user_id,owner.id);assert.equal(r.body.total,200);assert.equal(r.body.change,300);
            assert.equal(r.body.payments[0].status,'PAID');assert.equal(r.body.items[0].unit_cost,undefined);
            const detail=await get(`/transactions/${r.body.transaction_id}`).expect(200);assert.deepEqual(detail.body,r.body);
            assert.equal((await db.product_stocks.findFirstOrThrow({where:{product_id:product.id}})).stock,18);
        });
        await t.test('invalid nested inputs, QRIS and route IDs are rejected',async()=>{
            for(const patch of [{items:[]},{items:[{product_id:product.id,quantity:0}]},{payment:{method:'QRIS'}},{payment:{method:'CASH'}}]){
                await http.post('/transactions').set('Authorization',`Bearer ${auth}`).send({...body(),...patch}).expect(400);
            }
            await get('/transactions/not-a-uuid').expect(400);
            await get(`/transactions/${randomUUID()}`).expect(404);
        });
        await t.test('list and detail never expose the other tenant',async()=>{
            const list=await get('/transactions').expect(200);assert.equal(list.body.meta.total,3);
            assert.ok(list.body.data.every(row=>row.transaction_id!==foreign.id));
            await get(`/transactions/${foreign.id}`).expect(404);
            await get(`/transactions/${pending.id}`,authB).expect(404);
            const other=await get('/transactions',authB).expect(200);assert.equal(other.body.meta.total,1);
            await get(`/transactions?outlet_id=${ob.id}`).expect(404);
        });
        await t.test('pagination, status, outlet and exclusive end-date filters work',async()=>{
            const first=await get('/transactions?page=1&limit=1').expect(200), second=await get('/transactions?page=2&limit=1').expect(200);
            assert.equal(first.body.meta.total_pages,3);assert.equal(first.body.data.length,1);assert.notEqual(first.body.data[0].transaction_id,second.body.data[0].transaction_id);
            const dates=await get('/transactions?start_date=2026-01-01T00:00:00Z&end_date=2026-01-02T00:00:00Z').expect(200);
            assert.deepEqual(dates.body.data.map(r=>r.transaction_id),[pending.id]);
            const status=await get('/transactions?status=VOID').expect(200);assert.equal(status.body.data[0].transaction_id,voided.id);
            const outlet=await get(`/transactions?outlet_id=${oa2.id}`).expect(200);assert.equal(outlet.body.meta.total,1);
            const empty=await get('/transactions?status=CANCELLED').expect(200);assert.deepEqual(empty.body,{data:[],meta:{page:1,limit:20,total:0,total_pages:0}});
        });
        await t.test('invalid query values fail validation',async()=>{
            for(const query of ['page=0','limit=101','page=1.5','page=9007199254740991&limit=100','status=PAID','outlet_id=bad','start_date=2026-02-30T00:00:00Z','start_date=2026-01-02T00:00:00Z&end_date=2026-01-01T00:00:00Z']){
                await get(`/transactions?${query}`).expect(400);
            }
        });
        await t.test('cashier reads only assigned outlet and current DB role overrides token',async()=>{
            const list=await get('/transactions',cashAuth).expect(200);assert.equal(list.body.meta.total,2);assert.ok(list.body.data.every(row=>row.outlet_id===oa.id));
            await get(`/transactions/${voided.id}`,cashAuth).expect(404);
            await get(`/transactions?outlet_id=${oa2.id}`,cashAuth).expect(403);
            await db.users.update({where:{id:cashier.id},data:{outlet_id:null}});await get('/transactions',cashAuth).expect(403);
            await db.users.update({where:{id:cashier.id},data:{outlet_id:oa.id,is_active:false}});await get('/transactions',cashAuth).expect(401);
        });
        await t.test('pending/no-payment and QRIS details serialize safely',async()=>{
            let r=await get(`/transactions/${pending.id}`).expect(200);assert.equal(r.body.change,null);assert.deepEqual(r.body.payments,[]);
            await db.payments.create({data:{tenant_id:a.id,transaction_id:pending.id,method:'QRIS',status:'PENDING',amount:100}});
            r=await get(`/transactions/${pending.id}`).expect(200);assert.equal(r.body.change,null);assert.equal(r.body.payments[0].amount,100);assert.equal(r.body.payments[0].paid_at,null);
            await db.outlets.update({where:{id:oa.id},data:{is_active:false}});await get(`/transactions/${pending.id}`).expect(200);
        });
        await t.test('inactive tenant cannot read with an otherwise valid token',async()=>{
            await db.tenants.update({where:{id:b.id},data:{is_active:false}});await get('/transactions',authB).expect(401);
        });
    } finally {
        await app?.close();await db?.$disconnect();await admin.query('ROLLBACK');await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);await admin.end();
    }
});
