# API Specification & Contract - KasirKita POS (MVP V1)

**Version:** 1.0  
**Status:** FINAL V1  
**Base Path:** `/api/v1`

---

## 1. Purpose

Dokumen ini mendefinisikan kontrak REST API untuk KasirKita POS yang digunakan oleh:

- Android POS / cashier application
- Next.js web dashboard
- Backend NestJS
- Payment gateway integration
- Offline transaction synchronization

API harus konsisten dengan ERD Final V1 dan `DATABASE_SCHEMA.sql`.

---

# 2. Global Standards & Conventions

## 2.1 Base URL

```text
/api/v1
```

Contoh:

```http
GET /api/v1/products
```

---

## 2.2 Content Type

Request dan response menggunakan:

```http
Content-Type: application/json
```

Kecuali endpoint webhook/payment tertentu yang mengikuti format provider.

---

## 2.3 Authentication

Semua endpoint yang membutuhkan autentikasi wajib menggunakan:

```http
Authorization: Bearer <JWT_ACCESS_TOKEN>
```

Endpoint public V1:

```text
POST /auth/login
POST /auth/register          (jika registration flow diaktifkan)
POST /payments/webhook/:provider
```

Webhook tidak menggunakan JWT client. Webhook harus diverifikasi menggunakan mekanisme signature/secret dari payment provider.

---

# 3. Authentication & Tenant Isolation

## 3.1 JWT Claims

JWT minimal membawa:

```json
{
  "sub": "uuid-user",
  "tenant_id": "uuid-tenant",
  "outlet_id": "uuid-outlet",
  "role": "CASHIER"
}
```

`outlet_id` dapat bernilai `null` untuk user tenant-wide seperti OWNER.

---

## 3.2 Tenant Isolation Rule

Client **TIDAK BOLEH** mengirim `tenant_id` sebagai sumber otoritas.

Backend harus mengambil tenant dari JWT:

```text
JWT
 └── tenant_id
       ↓
Authenticated Request
       ↓
Service Layer
       ↓
Database Query
       ↓
WHERE tenant_id = JWT.tenant_id
```

Backend tidak boleh mempercayai:

```json
{
  "tenant_id": "some-other-tenant"
}
```

yang dikirim oleh client.

Jika resource milik tenant lain:

```text
404 NOT_FOUND
```

atau:

```text
403 TENANT_ACCESS_DENIED
```

Sesuai policy endpoint.

---

## 3.3 Outlet Isolation

User yang terikat pada outlet tertentu hanya boleh mengakses data outlet tersebut.

Contoh:

```text
JWT:
tenant_id = A
outlet_id = Outlet-1
role = CASHIER
```

Request:

```http
GET /stock/outlets/Outlet-2
```

Jika Outlet-2 bukan outlet yang diizinkan:

```text
403 FORBIDDEN
```

OWNER/ADMIN dapat mengakses outlet sesuai permission tenant.

---

# 4. Money Convention

Semua nilai uang menggunakan **integer IDR**.

Contoh:

```text
Rp15.000 → 15000
Rp1.500.000 → 1500000
```

Dilarang mengirim:

```json
{
  "price": 15000.50
}
```

Semua operasi perhitungan uang harus menggunakan integer.

---

# 5. Timestamp Convention

Semua timestamp API menggunakan ISO 8601 UTC.

Contoh:

```text
2026-09-11T13:35:51Z
```

Database menggunakan `TIMESTAMPTZ`.

Client bertanggung jawab melakukan konversi ke timezone lokal untuk tampilan.

---

# 6. Standard Response

## 6.1 Success

```json
{
  "success": true,
  "message": "Operation successful",
  "data": {}
}
```

`data` dapat berupa object atau array.

---

## 6.2 Paginated Response

```json
{
  "success": true,
  "message": "Transactions retrieved successfully",
  "data": [],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 150,
    "total_pages": 8
  }
}
```

---

## 6.3 Error Response

```json
{
  "success": false,
  "message": "Stock is insufficient",
  "error_code": "INSUFFICIENT_STOCK",
  "details": []
}
```

---

# 7. HTTP Status Codes

| Status | Meaning |
|---|---|
| 200 | Request berhasil |
| 201 | Resource berhasil dibuat |
| 400 | Invalid request |
| 401 | Authentication gagal/token tidak valid |
| 403 | Tidak memiliki permission |
| 404 | Resource tidak ditemukan |
| 409 | Conflict/duplicate/idempotency conflict |
| 422 | Validation error |
| 500 | Internal server error |
| 502 | External provider error |

---

# 8. Standard Error Codes

V1 menggunakan error code berikut:

```text
INVALID_INPUT
UNAUTHORIZED
FORBIDDEN
NOT_FOUND
DUPLICATE_RESOURCE
TENANT_ACCESS_DENIED
OUTLET_ACCESS_DENIED
INSUFFICIENT_STOCK
TRANSACTION_ALREADY_SYNCED
INVALID_TRANSACTION_STATE
INVALID_PAYMENT_STATE
PAYMENT_FAILED
PAYMENT_PENDING
PAYMENT_PROVIDER_ERROR
INVALID_WEBHOOK_SIGNATURE
```

---

# 9. Authentication API

## 9.1 Login

```http
POST /auth/login
```

### Request

```json
{
  "email": "cashier_a@toko.com",
  "password": "securepassword"
}
```

### Response

```json
{
  "success": true,
  "message": "Login successful",
  "data": {
    "access_token": "eyJhbG...",
    "user": {
      "id": "uuid-user-1",
      "name": "Budi Kasir",
      "email": "cashier_a@toko.com",
      "role": "CASHIER",
      "tenant_id": "uuid-tenant-1",
      "outlet_id": "uuid-outlet-1"
    }
  }
}
```

---

## 9.2 Get Current User

```http
GET /auth/me
```

Authentication required.

### Response

```json
{
  "success": true,
  "data": {
    "id": "uuid-user-1",
    "name": "Budi Kasir",
    "email": "cashier_a@toko.com",
    "role": "CASHIER",
    "tenant_id": "uuid-tenant-1",
    "outlet_id": "uuid-outlet-1"
  }
}
```

---

## 9.3 Logout

```http
POST /auth/logout
```

Authentication required.

V1 dapat menggunakan stateless JWT. Jika refresh-token/session revocation ditambahkan kemudian, endpoint ini dapat melakukan invalidation terhadap refresh token.

---

# 10. Categories API

## 10.1 Get Categories

```http
GET /categories
```

Optional query:

```text
?page=1&limit=20
```

### Response

```json
{
  "success": true,
  "data": [
    {
      "id": "uuid-cat-1",
      "name": "Minuman",
      "created_at": "2026-09-11T13:00:00Z",
      "updated_at": "2026-09-11T13:00:00Z"
    }
  ]
}
```

Backend otomatis membatasi hasil berdasarkan JWT tenant.

---

## 10.2 Create Category

```http
POST /categories
```

Roles:

```text
OWNER
ADMIN
```

### Request

```json
{
  "name": "Minuman"
}
```

`tenant_id` tidak boleh dikirim client.

### Response

```json
{
  "success": true,
  "message": "Category created successfully",
  "data": {
    "id": "uuid-cat-1",
    "name": "Minuman"
  }
}
```

---

## 10.3 Update Category

```http
PATCH /categories/:categoryId
```

Roles:

```text
OWNER
ADMIN
```

### Request

```json
{
  "name": "Minuman & Jus"
}
```

Backend memastikan category berada pada tenant JWT.

---

## 10.4 Delete Category

```http
DELETE /categories/:categoryId
```

Roles:

```text
OWNER
ADMIN
```

Jika category masih digunakan oleh product, backend sebaiknya menolak hard delete.

---

# 11. Products API

## 11.1 Get Products

```http
GET /products
```

Optional query:

```text
?category_id=uuid
&is_active=true
&page=1
&limit=20
&search=coca
```

### Response

```json
{
  "success": true,
  "data": [
    {
      "id": "uuid-prod-1",
      "category_id": "uuid-cat-1",
      "name": "Coca Cola",
      "sku": "CC-001",
      "price": 15000,
      "cost": 10000,
      "minimum_stock": 5,
      "is_active": true
    }
  ],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 1,
    "total_pages": 1
  }
}
```

---

## 11.2 Get Product Detail

```http
GET /products/:productId
```

Backend hanya boleh mengembalikan product dari tenant JWT.

---

## 11.3 Create Product

```http
POST /products
```

Roles:

```text
OWNER
ADMIN
```

### Request

```json
{
  "category_id": "uuid-cat-1",
  "name": "Indomie Goreng",
  "sku": "IDM-GRG",
  "price": 3000,
  "cost": 2500,
  "minimum_stock": 10
}
```

### Rules

- `tenant_id` diambil dari JWT.
- `category_id` harus milik tenant yang sama.
- SKU harus unik dalam tenant.
- Price >= 0.
- Cost >= 0.
- Minimum stock >= 0.

---

## 11.4 Update Product

```http
PATCH /products/:productId
```

Roles:

```text
OWNER
ADMIN
```

Contoh:

```json
{
  "price": 3500,
  "cost": 2700
}
```

Perubahan product tidak boleh mengubah historical `transaction_items`.

---

## 11.5 Deactivate Product

```http
DELETE /products/:productId
```

Untuk V1, endpoint ini direkomendasikan melakukan **soft delete/deactivation**:

```text
is_active = false
```

Historical transactions tetap dipertahankan.

---

# 12. Stock API

## 12.1 Get Stock by Outlet

```http
GET /stock/outlets/:outletId
```

Optional:

```text
?product_id=uuid
&low_stock=true
&page=1
&limit=20
```

### Response

```json
{
  "success": true,
  "data": [
    {
      "product_id": "uuid-prod-1",
      "product_name": "Coca Cola",
      "sku": "CC-001",
      "quantity": 45,
      "minimum_stock": 5
    }
  ]
}
```

### Security

Backend wajib memastikan:

```text
outlet.tenant_id == JWT.tenant_id
```

dan user memiliki akses terhadap outlet tersebut.

---

## 12.2 Create Stock Adjustment

```http
POST /stock/adjustments
```

Roles:

```text
OWNER
ADMIN
```

### Request

```json
{
  "outlet_id": "uuid-outlet-1",
  "product_id": "uuid-prod-1",
  "type": "ADD",
  "quantity": 10,
  "reason": "Barang masuk dari supplier"
}
```

### Rules

- `tenant_id` berasal dari JWT.
- Outlet dan product harus berasal dari tenant yang sama.
- Quantity harus > 0.
- `ADD` menambah stock.
- `DEDUCT` mengurangi stock.
- DEDUCT tidak boleh membuat stock menjadi negatif.
- Adjustment dan stock movement harus dibuat dalam satu database transaction.

### Backend Flow

```text
Stock Adjustment
      ↓
Lock Product Stock
      ↓
Validate Quantity
      ↓
Update product_stocks
      ↓
Insert stock_adjustments
      ↓
Insert stock_movements
      ↓
COMMIT
```

### Response

```json
{
  "success": true,
  "message": "Stock adjusted successfully",
  "data": {
    "adjustment_id": "uuid-adj-1",
    "new_quantity": 55
  }
}
```

---

## 12.3 Get Stock Movements

```http
GET /stock/movements
```

Optional:

```text
?outlet_id=uuid
&product_id=uuid
&type=SALE
&start_date=2026-09-01
&end_date=2026-09-11
&page=1
&limit=20
```

### Response

```json
{
  "success": true,
  "data": [
    {
      "id": "uuid-movement-1",
      "product_id": "uuid-prod-1",
      "outlet_id": "uuid-outlet-1",
      "type": "SALE",
      "quantity": -2,
      "reference_type": "TRANSACTION",
      "reference_id": "uuid-trx-1",
      "created_at": "2026-09-11T13:35:51Z"
    }
  ]
}
```

Stock movement bersifat audit-oriented dan tidak boleh diedit oleh client.

---

# 13. Transaction API

Transaction adalah bagian paling kritis dari V1.

## 13.1 Create / Sync Transaction

```http
POST /transactions
```

Authentication required.

---

## 13.2 Idempotency

Android menghasilkan:

```text
client_transaction_id = UUID
```

Contoh:

```text
550e8400-e29b-41d4-a716-446655440000
```

Backend memiliki unique constraint:

```text
(tenant_id, client_transaction_id)
```

Jika UUID tersebut sudah pernah diproses:

```text
JANGAN membuat transaction baru.
```

Backend mengembalikan transaction existing.

---

## 13.3 Request

Client mengirim snapshot harga jual karena transaksi dapat dibuat ketika offline.

```json
{
  "outlet_id": "uuid-outlet-1",
  "client_transaction_id": "uuid-client-transaction-1",
  "subtotal": 30000,
  "tax": 0,
  "discount": 0,
  "total": 30000,
  "items": [
    {
      "product_id": "uuid-prod-1",
      "quantity": 2,
      "unit_price": 15000
    }
  ],
  "payment": {
    "method": "CASH",
    "amount": 50000
  }
}
```

### Client MUST NOT send

```text
tenant_id
unit_cost
payment.status
transaction.status
stock quantity after sale
```

---

## 13.4 Backend Calculation Rules

Backend tidak boleh mempercayai total dari client secara langsung.

Backend harus menghitung ulang:

```text
item subtotal
    = quantity × unit_price

subtotal
    = SUM(item subtotal)

total
    = subtotal + tax - discount
```

Kemudian membandingkan dengan request.

Untuk `unit_cost`:

```text
products.cost
      ↓
transaction_items.unit_cost
```

`unit_cost` adalah snapshot historical dan ditentukan backend.

---

## 13.5 Cash Transaction Flow

```text
POST /transactions
       ↓
Validate JWT/RBAC/Tenant
       ↓
Check client_transaction_id
       ↓
Load products
       ↓
Validate prices
       ↓
Calculate totals
       ↓
Lock product_stocks
       ↓
Validate stock
       ↓
Create transaction
       ↓
Create transaction_items
       ↓
Create payment PAID
       ↓
Deduct stock
       ↓
Create SALE stock_movements
       ↓
COMMIT
```

Transaction menjadi:

```text
COMPLETED
```

hanya setelah payment dianggap berhasil.

---

## 13.6 QRIS Transaction Flow

```text
POST /transactions
       ↓
Transaction PENDING
       ↓
Payment PENDING
       ↓
Create QRIS payment
       ↓
Customer pays
       ↓
Payment Provider Webhook
       ↓
Verify webhook
       ↓
Payment PAID
       ↓
Deduct stock
       ↓
Create SALE movement
       ↓
Transaction COMPLETED
```

Client tidak boleh mengubah payment menjadi `PAID`.

---

## 13.7 Transaction Database Atomicity

Cash transaction dan operasi stock yang terkait harus dijalankan menggunakan database transaction:

```text
BEGIN

transaction
transaction_items
payment
product_stocks
stock_movements

COMMIT
```

Jika salah satu operasi gagal:

```text
ROLLBACK
```

Tidak boleh meninggalkan partial transaction.

---

## 13.8 Insufficient Stock

Jika:

```text
requested = 10
available = 5
```

response:

```http
409 Conflict
```

```json
{
  "success": false,
  "message": "Insufficient stock",
  "error_code": "INSUFFICIENT_STOCK",
  "details": [
    {
      "product_id": "uuid-prod-1",
      "requested": 10,
      "available": 5
    }
  ]
}
```

Tidak ada transaction yang boleh dianggap berhasil.

---

# 14. Get Transactions

```http
GET /transactions
```

Optional query:

```text
?outlet_id=uuid
&status=COMPLETED
&start_date=2026-09-11
&end_date=2026-09-11
&page=1
&limit=20
```

### Response

```json
{
  "success": true,
  "data": [
    {
      "id": "uuid-trx-1",
      "outlet_id": "uuid-outlet-1",
      "cashier_id": "uuid-user-1",
      "subtotal": 30000,
      "tax": 0,
      "discount": 0,
      "total": 30000,
      "status": "COMPLETED",
      "created_at": "2026-09-11T13:35:51Z"
    }
  ],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 45,
    "total_pages": 3
  }
}
```

---

# 15. Get Transaction Detail

```http
GET /transactions/:transactionId
```

### Response

```json
{
  "success": true,
  "data": {
    "id": "uuid-trx-1",
    "outlet_id": "uuid-outlet-1",
    "cashier_id": "uuid-user-1",
    "subtotal": 30000,
    "tax": 0,
    "discount": 0,
    "total": 30000,
    "status": "COMPLETED",
    "items": [
      {
        "product_id": "uuid-prod-1",
        "quantity": 2,
        "unit_price": 15000,
        "subtotal": 30000
      }
    ],
    "payments": [
      {
        "method": "CASH",
        "status": "PAID",
        "amount": 50000,
        "paid_at": "2026-09-11T13:35:51Z"
      }
    ]
  }
}
```

`unit_cost` tidak perlu dikembalikan ke cashier UI kecuali dibutuhkan oleh authorized reporting/admin flow.

---

# 16. Payment API

## 16.1 Create QRIS Payment

```http
POST /payments/qris
```

Authentication required.

### Request

```json
{
  "transaction_id": "uuid-trx-1"
}
```

Client tidak perlu mengirim amount sebagai sumber kebenaran.

Backend mengambil:

```text
transactions.total
```

### Response

```json
{
  "success": true,
  "data": {
    "payment_id": "uuid-payment-1",
    "status": "PENDING",
    "provider": "MIDTRANS",
    "provider_reference": "ref-12345",
    "provider_qr_url": "https://provider.example/qris/..."
  }
}
```

---

## 16.2 Get Payment Status

```http
GET /payments/:paymentId
```

### Response

```json
{
  "success": true,
  "data": {
    "id": "uuid-payment-1",
    "transaction_id": "uuid-trx-1",
    "method": "QRIS",
    "status": "PENDING",
    "amount": 30000,
    "paid_at": null
  }
}
```

---

# 17. Payment Webhook

```http
POST /payments/webhook/:provider
```

Contoh:

```http
POST /payments/webhook/midtrans
```

Webhook tidak menggunakan JWT.

Provider signature harus diverifikasi.

### Security

Backend wajib:

1. Memverifikasi signature.
2. Memastikan provider reference valid.
3. Memastikan payment masih berada pada state yang dapat diubah.
4. Memastikan amount sesuai.
5. Memastikan transaction/payment berasal dari tenant yang benar melalui database relation.
6. Memproses webhook secara idempotent.

Jika signature tidak valid:

```http
401 Unauthorized
```

```json
{
  "success": false,
  "message": "Invalid webhook signature",
  "error_code": "INVALID_WEBHOOK_SIGNATURE"
}
```

---

## 17.1 Successful Payment Webhook

```text
Webhook
   ↓
Verify Signature
   ↓
Find Payment
   ↓
Check Current Status
   ↓
Validate Amount
   ↓
BEGIN DB TRANSACTION
   ↓
Payment = PAID
   ↓
Deduct Product Stock
   ↓
Create SALE Stock Movement
   ↓
Transaction = COMPLETED
   ↓
COMMIT
```

Webhook retry setelah payment sudah `PAID` tidak boleh mengurangi stock dua kali.

---

# 18. Reports API

## 18.1 Daily Sales Summary

```http
GET /reports/sales/daily
```

Query:

```text
?outlet_id=uuid
&date=2026-09-11
```

### Response

```json
{
  "success": true,
  "data": {
    "date": "2026-09-11",
    "outlet_id": "uuid-outlet-1",
    "total_revenue": 1500000,
    "total_transactions": 45,
    "total_cogs": 1000000,
    "gross_profit": 500000
  }
}
```

---

## 18.2 Gross Profit Calculation

Gross profit:

```text
Gross Profit
= Revenue - COGS
```

COGS:

```text
COGS
= SUM(transaction_items.quantity × transaction_items.unit_cost)
```

Hanya transaction dengan status yang dianggap successful, terutama:

```text
COMPLETED
```

yang masuk ke laporan penjualan.

Historical `unit_cost` digunakan agar perubahan product cost tidak mengubah laporan masa lalu.

---

# 19. Role & Permission Matrix

| Endpoint/Action | OWNER | ADMIN | CASHIER |
|---|---:|---:|---:|
| Login | ✅ | ✅ | ✅ |
| Get own profile | ✅ | ✅ | ✅ |
| View categories | ✅ | ✅ | ✅ |
| Create/update category | ✅ | ✅ | ❌ |
| View products | ✅ | ✅ | ✅ |
| Create/update product | ✅ | ✅ | ❌ |
| Deactivate product | ✅ | ✅ | ❌ |
| View stock | ✅ | ✅ | ✅ |
| Stock adjustment | ✅ | ✅ | ❌ |
| View stock movement | ✅ | ✅ | Limited |
| Create transaction | ✅ | ✅ | ✅ |
| View transactions | ✅ | ✅ | Own/outlet |
| Create QRIS payment | ✅ | ✅ | ✅ |
| View reports | ✅ | ✅ | Limited/No |
| Tenant administration | ✅ | Limited | ❌ |

Permission detail dapat diperketat pada implementasi NestJS.

---

# 20. Offline Sync Rules

Android menyimpan transaction secara lokal menggunakan Room ketika offline.

Local state:

```text
PENDING_SYNC
      ↓
SYNCING
      ↓
SYNCED
```

Jika gagal:

```text
FAILED
```

Saat online:

```http
POST /transactions
```

dengan:

```json
{
  "client_transaction_id": "uuid-generated-locally"
}
```

Backend menggunakan:

```text
UNIQUE (tenant_id, client_transaction_id)
```

untuk memastikan transaksi tidak dibuat dua kali.

---

# 21. Idempotency Rules

Idempotency berlaku untuk:

```text
POST /transactions
POST /payments/qris
POST /payments/webhook/:provider
```

### Transaction

Jika:

```text
tenant_id + client_transaction_id
```

sudah ada, return transaction existing.

### Webhook

Jika payment sudah:

```text
PAID
```

webhook duplicate tidak boleh:

```text
deduct stock again
create movement again
```

---

# 22. Validation Rules

Backend wajib melakukan validation walaupun Android/Next.js juga melakukan validation.

Minimal:

### Product

```text
name != empty
sku != empty
price >= 0
cost >= 0
minimum_stock >= 0
```

### Transaction

```text
items.length > 0
quantity > 0
unit_price >= 0
subtotal >= 0
tax >= 0
discount >= 0
total >= 0
```

### Stock

```text
quantity > 0
```

### Payment

```text
amount > 0
```

Validation client hanya untuk UX.

Validation backend adalah source of truth.

---

# 23. Transaction State Rules

## PENDING

Transaction belum berhasil dibayar/selesai.

```text
PENDING
```

## COMPLETED

Payment berhasil dan transaction sudah selesai.

```text
COMPLETED
```

Stock sudah dikurangi.

## CANCELLED

Transaction dibatalkan sebelum completion sesuai business rule.

## VOID

Transaction yang sebelumnya berhasil kemudian dibatalkan/void.

Jika VOID memerlukan pengembalian stock:

```text
VOID
  ↓
RETURN/VOID stock movement
  ↓
restore stock
```

Detail void/return flow dapat diperluas pada V1.1.

---

# 24. Database ↔ API Mapping

| API Resource | Database Table |
|---|---|
| Auth user | users |
| Category | categories |
| Product | products |
| Product stock | product_stocks |
| Transaction | transactions |
| Transaction item | transaction_items |
| Payment | payments |
| Stock adjustment | stock_adjustments |
| Stock history | stock_movements |
| Sales report | Derived from transaction tables |

Tidak diperlukan tabel `reports` pada V1.

---

# 25. API Architecture

```text
Android POS
      │
      │ REST + JWT
      ▼
┌──────────────────────┐
│ NestJS API           │
│                      │
│ Auth                 │
│ RBAC                 │
│ Tenant Isolation     │
│ Validation           │
│ Business Logic       │
└──────────┬───────────┘
           │
           ▼
     PostgreSQL
           │
     ┌─────┴─────┐
     │           │
 Transactions   Stock
     │           │
     └─────┬─────┘
           │
           ▼
     Payment Provider
           │
        Webhook
           │
           ▼
      NestJS API
```

---

# 26. Golden Rules

1. Client tidak menentukan `tenant_id`.
2. Backend mengambil tenant dari JWT.
3. Backend wajib melakukan authorization berdasarkan tenant dan outlet.
4. Client tidak menentukan `unit_cost`.
5. Client tidak menentukan `payment.status`.
6. Client tidak menentukan `transaction.status`.
7. Backend menghitung ulang subtotal dan total.
8. Stock hanya berkurang ketika transaction/payment dianggap berhasil.
9. Stock update dan stock movement harus atomic.
10. Historical `unit_price` dan `unit_cost` tidak boleh berubah.
11. Offline transaction wajib menggunakan `client_transaction_id`.
12. Duplicate sync tidak boleh membuat transaksi kedua.
13. Webhook payment wajib diverifikasi.
14. Duplicate webhook tidak boleh mengurangi stock dua kali.
15. Semua money values menggunakan integer IDR.
16. Semua tenant-scoped query harus menggunakan tenant context dari JWT.
17. Reports dihitung dari historical transaction data, bukan dari current product price/cost.
18. Backend validation adalah source of truth.

---

# 27. V1 Scope

### Included

```text
Authentication
Categories
Products
Product Stock
Stock Adjustment
Stock Movement
Transactions
Offline Transaction Sync
Cash Payment
QRIS Payment Contract
Payment Webhook Contract
Daily Sales Report
RBAC
Tenant Isolation
```

### Deferred

```text
Product Variants
Customers
Suppliers
Purchases
Expenses
Cashier Shifts
Promotions
Discount Rules
Advanced Reporting
Refund Workflow
Receipt Printing API
Barcode API
```

---

# 28. Implementation Notes

Dokumen ini adalah **API Contract**, bukan implementasi.

Urutan implementasi backend yang direkomendasikan:

```text
1. Database migration
2. NestJS project/module structure
3. Auth + JWT
4. Tenant/RBAC guards
5. Categories
6. Products
7. Product Stock
8. Stock Adjustment
9. Transactions
10. Offline sync/idempotency
11. Cash payment
12. QRIS/payment abstraction
13. Webhook
14. Reports
15. Automated tests
```

Setiap endpoint harus memiliki unit/integration test sesuai tingkat risikonya.

---

# 29. Status

```text
API_SPEC.md
Version: 1.0
Status: FINAL V1
Compatible with:
- ERD Final V1
- DATABASE_SCHEMA.sql
- PROJECT_CONTEXT.md
```

Dokumen ini menjadi kontrak utama antara:

```text
Android ↔ NestJS ↔ PostgreSQL
Next.js ↔ NestJS ↔ PostgreSQL
Payment Provider ↔ NestJS
```
