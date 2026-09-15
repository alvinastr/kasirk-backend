// Run: TS_NODE_PROJECT=test/tsconfig.hardening.json TRANSACTION_TEST_DATABASE_URL=... node --require ts-node/register/transpile-only --test test/transactions-service.integration.cjs
// Supply a disposable database explicitly. Each run owns and drops only a random schema.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const { Client } = require('pg');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { TransactionsService } = require('../src/transactions/transactions.service');
const { StockService } = require('../src/stock/stock.service');
const { Logger } = require('@nestjs/common');

test('Transaction CASH checkout', { skip: !process.env.TRANSACTION_TEST_DATABASE_URL }, async (t) => {
    const connectionString = process.env.TRANSACTION_TEST_DATABASE_URL;
    const schema = `checkout_${randomUUID().replaceAll('-', '')}`;
    const admin = new Client({ connectionString });
    await admin.connect();
    let db;
    try {
        await admin.query(`CREATE SCHEMA "${schema}"`);
        await admin.query(`SET search_path TO "${schema}"`);
        for (const name of ['20260914000000_baseline','20260914000100_transaction_tenant_integrity','20260915000000_optional_tenant_tax','20260915010000_add_customers']) {
            await admin.query(readFileSync(join(__dirname,'../prisma/migrations',name,'migration.sql'),'utf8').replaceAll('"public"',`"${schema}"`));
        }
        db = new PrismaClient({ adapter: new PrismaPg({ connectionString }, { schema }) });
        const service = new TransactionsService(db);
        const stockService = new StockService(db);
        const tenant = await db.tenants.create({data:{name:'A',tax_enabled:true,tax_rate:10}});
        const other = await db.tenants.create({data:{name:'B'}});
        const outlet = await db.outlets.create({data:{tenant_id:tenant.id,name:'A'}});
        const otherOutlet = await db.outlets.create({data:{tenant_id:other.id,name:'B'}});
        const actor = await db.users.create({data:{tenant_id:tenant.id,name:'Owner',email:'owner@test',password_hash:'fixture',role:'OWNER'}});
        const otherActor = await db.users.create({data:{tenant_id:other.id,name:'Owner B',email:'owner@test',password_hash:'fixture',role:'OWNER'}});
        const user = {sub:actor.id,tenant_id:tenant.id,role:'OWNER'};
        const userB = {sub:otherActor.id,tenant_id:other.id,role:'OWNER'};
        async function product(stock=10,price=100,cost=50,tenant_id=tenant.id,outlet_id=outlet.id) {
            const p=await db.products.create({data:{tenant_id,name:'Product',sku:randomUUID(),price,cost}});
            if(stock!==null)await db.product_stocks.create({data:{product_id:p.id,outlet_id,stock}});
            return p;
        }
        function request(p,quantity=2){return {client_transaction_id:randomUUID(),outlet_id:outlet.id,items:[{product_id:p.id,quantity}],discount:0,payment:{method:'CASH',amount:10000}};}
        async function balance(p){return (await db.product_stocks.findFirstOrThrow({where:{product_id:p.id}})).stock;}
        async function noSale(dto,p,initial){
            assert.equal(await db.transactions.count({where:{client_transaction_id:dto.client_transaction_id}}),0);
            assert.equal(await db.transaction_items.count({where:{product_id:p.id}}),0);
            assert.equal(await db.stock_movements.count({where:{product_id:p.id}}),0);
            if(initial!==null)assert.equal(await balance(p),initial);
        }
        await t.test('multi-product checkout snapshots prices, pays CASH and writes SALE only',async()=>{
            const a=await product(), b=await product(10,150,70);const dto=request(a);dto.items.push({product_id:b.id,quantity:1});dto.discount=50;
            const result=await service.create(user,dto);
            assert.equal(result.status,'COMPLETED');assert.equal(result.subtotal,350);assert.equal(result.discount,50);assert.equal(result.tax,30);assert.equal(result.total,330);assert.equal(result.change,9670);
            assert.equal(result.payments[0].status,'PAID');assert.ok(result.payments[0].paid_at);assert.equal(result.payments[0].amount,10000);
            assert.equal(await balance(a),8);assert.equal(await balance(b),9);
            const stored=await db.transactions.findUniqueOrThrow({where:{id:result.transaction_id},include:{transaction_items:true,payments:true}});
            assert.equal(stored.user_id,user.sub);assert.equal(stored.tenant_id,user.tenant_id);
            assert.ok(stored.transaction_items.every(i=>i.tenant_id===tenant.id));assert.equal(stored.transaction_items.find(i=>i.product_id===a.id).unit_cost,50n);
            assert.ok(result.items.every(i=>!('unit_cost' in i)));assert.doesNotThrow(()=>JSON.stringify(result));
            const movements=await db.stock_movements.findMany({where:{reference_id:result.transaction_id}});
            assert.equal(movements.length,2);assert.equal(movements.reduce((n,m)=>n+m.quantity,0),-3);
            assert.ok(movements.every(m=>m.type==='SALE'&&m.reference_type==='TRANSACTION'&&m.user_id===user.sub&&m.tenant_id===tenant.id));
            assert.equal(await db.stock_adjustments.count(),0);
        });
        await t.test('optional tax: disabled 11% gives 20000, enabled gives 22200',async()=>{
            try {
                for(const enabled of [false,true]) {
                    await db.tenants.update({where:{id:tenant.id},data:{tax_enabled:enabled,tax_rate:11}});
                    const p=await product(10,10000);const dto=request(p);dto.payment.amount=enabled?22200:20000;
                    const r=await service.create(user,dto);
                    assert.equal(r.subtotal,20000);assert.equal(r.tax,enabled?2200:0);assert.equal(r.total,enabled?22200:20000);assert.equal(r.change,0);
                }
            } finally { await db.tenants.update({where:{id:tenant.id},data:{tax_enabled:true,tax_rate:10}}); }
        });
        await t.test('tax applies after discount, insufficient CASH returns its error code and rolls back',async()=>{
            await db.tenants.update({where:{id:tenant.id},data:{tax_enabled:true,tax_rate:11}});
            try {
                const p=await product(10,10000);const dto=request(p);dto.payment.amount=20000;
                await assert.rejects(service.create(user,dto),e=>e.status===400&&e.getResponse().error_code==='INSUFFICIENT_PAYMENT');await noSale(dto,p,10);
                const discounted={...dto,discount:2000,payment:{method:'CASH',amount:20000}};
                const result=await service.create(user,discounted);assert.equal(result.tax,1980);assert.equal(result.total,19980);assert.equal(result.change,20);
                await db.tenants.update({where:{id:tenant.id},data:{tax_enabled:false,tax_rate:0}});
                assert.deepEqual(await service.create(user,discounted),result);
            } finally { await db.tenants.update({where:{id:tenant.id},data:{tax_enabled:true,tax_rate:10}}); }
        });
        await t.test('new tenant defaults tax settings to false and zero',async()=>{
            const fresh=await db.tenants.create({data:{name:'Default settings'}});
            assert.equal(fresh.tax_enabled,false);assert.equal(fresh.tax_included,false);assert.equal(fresh.tax_rate.toString(),'0');
        });
        await t.test('tax uses decimal rounding and exact payment works',async()=>{
            await db.tenants.update({where:{id:tenant.id},data:{tax_rate:'2.50'}});
            try{const p=await product(1,20);const dto=request(p,1);dto.payment.amount=21;const r=await service.create(user,dto);assert.equal(r.tax,1);assert.equal(r.change,0);}finally{await db.tenants.update({where:{id:tenant.id},data:{tax_rate:10}});}
        });
        await t.test('same request replays stored price and cannot be reused for different input',async()=>{
            const p=await product();const dto=request(p);const first=await service.create(user,dto);
            await db.products.update({where:{id:p.id},data:{price:999,cost:888}});
            const second=await service.create(user,dto);assert.deepEqual(second,first);assert.equal(await balance(p),8);
            await assert.rejects(service.create(user,{...dto,payment:{method:'CASH',amount:10001}}),{status:409});
            await assert.rejects(service.create(user,{...dto,items:[{product_id:p.id,quantity:1}]}),{status:409});
            assert.equal(await db.payments.count({where:{transaction_id:first.transaction_id}}),1);
        });
        await t.test('simultaneous identical client IDs create one sale',async()=>{
            const p=await product();const dto=request(p);const [a,b]=await Promise.all([service.create(user,dto),service.create(user,dto)]);
            assert.equal(a.transaction_id,b.transaction_id);assert.equal(await balance(p),8);
            assert.equal(await db.stock_movements.count({where:{product_id:p.id}}),1);
        });
        await t.test('concurrent checkouts cannot oversell',async()=>{
            const p=await product(3);const results=await Promise.allSettled([service.create(user,request(p,2)),service.create(user,request(p,2))]);
            assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.status,409);assert.equal(await balance(p),1);
        });
        await t.test('checkout and manual adjustment share stock safety',async()=>{
            const p=await product(3);const results=await Promise.allSettled([service.create(user,request(p,2)),stockService.createAdjustment(user,{outlet_id:outlet.id,product_id:p.id,quantity:2,adjustment_type:'DEDUCT',reason:'test'})]);
            assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(await balance(p),1);
        });
        await t.test('insufficient second item rolls back the first deduction and all sale rows',async()=>{
            const a=await product(10),b=await product(10);const sorted=[a,b].sort((a,b)=>a.id.localeCompare(b.id));
            await db.product_stocks.updateMany({where:{product_id:sorted[1].id},data:{stock:0}});
            const dto=request(sorted[0]);dto.items.push({product_id:sorted[1].id,quantity:1});
            await assert.rejects(service.create(user,dto),{status:409});await noSale(dto,sorted[0],10);
        });
        await t.test('missing stock fails without creating a stock row',async()=>{
            const p=await product(null);const dto=request(p);await assert.rejects(service.create(user,dto),{status:409});await noSale(dto,p,null);assert.equal(await db.product_stocks.count({where:{product_id:p.id}}),0);
        });
        await t.test('payment database failure rolls back stock, items and movements',async()=>{
            const p=await product();const dto=request(p);dto.payment.amount=9999;
            await admin.query('ALTER TABLE payments ADD CONSTRAINT force_payment_failure CHECK (amount <> 9999)');
            Logger.overrideLogger(false);
            try{await assert.rejects(service.create(user,dto),{status:500});await noSale(dto,p,10);}finally{await admin.query('ALTER TABLE payments DROP CONSTRAINT force_payment_failure');Logger.overrideLogger(['error','warn','log']);}
        });
        await t.test('foreign resources and actor are rejected; tenant scoped client ID is independent',async()=>{
            const p=await product(),foreign=await product(10,100,50,other.id,otherOutlet.id);const dto=request(p);
            await assert.rejects(service.create(user,{...dto,outlet_id:otherOutlet.id}),{status:404});
            await assert.rejects(service.create(user,{...dto,items:[{product_id:foreign.id,quantity:1}]}),{status:404});
            await assert.rejects(service.create({...user,sub:otherActor.id},dto),{status:401});await noSale(dto,p,10);
            const a=await service.create(user,dto);const b=await service.create(userB,{...dto,outlet_id:otherOutlet.id,items:[{product_id:foreign.id,quantity:1}]});assert.notEqual(a.transaction_id,b.transaction_id);
        });
        await t.test('inactive resources and cashier outlet/discount restrictions',async()=>{
            const p=await product();const dto=request(p);
            await db.products.update({where:{id:p.id},data:{is_active:false}});await assert.rejects(service.create(user,dto),{status:404});
            await db.products.update({where:{id:p.id},data:{is_active:true}});
            const cashier=await db.users.create({data:{tenant_id:tenant.id,name:'Cashier',email:'cashier@test',password_hash:'fixture',role:'CASHIER'}});
            const ctx={...user,sub:cashier.id};await assert.rejects(service.create(ctx,dto),{status:403});
            await db.users.update({where:{id:cashier.id},data:{outlet_id:outlet.id}});await assert.rejects(service.create(ctx,{...dto,discount:1}),{status:403});
            await db.users.update({where:{id:cashier.id},data:{is_active:false}});await assert.rejects(service.create(ctx,dto),{status:401});
        });
        await t.test('QRIS, insufficient cash, invalid discount and malformed items never write',async()=>{
            const p=await product();const dto=request(p);
            for(const patch of [{payment:{method:'QRIS'}},{payment:{method:'CASH',amount:1}},{discount:1000},{items:[]},{items:[{product_id:p.id,quantity:0}]},{tenant_id:other.id},{discount:200}]){
                await assert.rejects(service.create(user,{...dto,...patch}),{status:400});await noSale(dto,p,10);
            }
            const huge=await product(2147483647,2147483647);const large=request(huge,2147483647);large.payment.amount=Number.MAX_SAFE_INTEGER;
            await assert.rejects(service.create(user,large),{status:400});await noSale(large,huge,2147483647);
        });
    } finally {
        await db?.$disconnect();await admin.query('ROLLBACK');await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);await admin.end();
    }
});
