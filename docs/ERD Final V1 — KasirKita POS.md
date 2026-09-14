# ERD — Final V1 Data Model KasirKita POS

## 1. Tujuan

ERD ini merupakan baseline data model untuk KasirKita POS V1.

Model dirancang untuk mendukung:

- Multi-tenant
- Multi-outlet
- Operasional kasir
- Product & category management
- Stock per outlet
- Sales transaction
- Payment
- Stock audit trail
- Offline transaction synchronization
- Financial reporting dasar

Prinsip utama:

> Simple → Reliable → Secure → Maintainable → Affordable → Scalable

---

# 2. Entity Overview

V1 terdiri dari 11 entitas utama:

1. Tenant
2. Outlet
3. User
4. Category
5. Product
6. Product Stock
7. Transaction
8. Transaction Item
9. Payment
10. Stock Movement
11. Stock Adjustment

---

# 3. Tenant

Merepresentasikan bisnis/pelanggan yang menggunakan KasirKita.

### Fields

- `id`: UUID PK
- `name`: VARCHAR
- `address`: TEXT
- `tax_rate`: INTEGER
- `is_active`: BOOLEAN
- `created_at`: TIMESTAMP
- `updated_at`: TIMESTAMP

### Rules

- Satu tenant dapat memiliki banyak outlet.
- Semua data bisnis tenant harus terisolasi berdasarkan `tenant_id`.
- `tax_rate` menggunakan nilai integer yang merepresentasikan persentase pajak.

---

# 4. Outlet

Merepresentasikan cabang/toko milik sebuah tenant.

### Fields

- `id`: UUID PK
- `tenant_id`: UUID FK → `tenants.id`
- `name`: VARCHAR
- `address`: TEXT
- `is_active`: BOOLEAN
- `created_at`: TIMESTAMP
- `updated_at`: TIMESTAMP

### Relationships

```text
Tenant 1 ─── N Outlet
```

### Rules

- Setiap outlet hanya dimiliki satu tenant.
- Outlet tidak boleh digunakan oleh tenant lain.
- Data transaksi dan stok selalu terkait dengan outlet.

---

# 5. User

Merepresentasikan pengguna sistem.

### Fields

- `id`: UUID PK
- `tenant_id`: UUID FK → `tenants.id`
- `outlet_id`: UUID FK → `outlets.id` NULL
- `name`: VARCHAR
- `email`: VARCHAR
- `password_hash`: VARCHAR
- `role`: ENUM
- `is_active`: BOOLEAN
- `created_at`: TIMESTAMP
- `updated_at`: TIMESTAMP

### Roles

```text
OWNER
ADMIN
CASHIER
```

### Relationships

```text
Tenant 1 ─── N User
Outlet 1 ─── N User
```

### Rules

- User selalu dimiliki oleh satu tenant.
- `outlet_id` boleh NULL untuk user dengan akses tenant-wide seperti OWNER.
- CASHIER pada normalnya dikaitkan dengan outlet tertentu.
- Authorization wajib ditegakkan backend.

---

# 6. Category

Merepresentasikan kategori produk.

### Fields

- `id`: UUID PK
- `tenant_id`: UUID FK → `tenants.id`
- `name`: VARCHAR
- `created_at`: TIMESTAMP
- `updated_at`: TIMESTAMP

### Relationships

```text
Tenant 1 ─── N Category
Category 1 ─── N Product
```

### Rules

Kategori hanya dapat digunakan oleh product dari tenant yang sama.

---

# 7. Product

Merepresentasikan produk yang dijual.

### Fields

- `id`: UUID PK
- `tenant_id`: UUID FK → `tenants.id`
- `category_id`: UUID FK → `categories.id`
- `name`: VARCHAR
- `sku`: VARCHAR
- `price`: INTEGER
- `cost`: INTEGER
- `minimum_stock`: INTEGER
- `is_active`: BOOLEAN
- `created_at`: TIMESTAMP
- `updated_at`: TIMESTAMP

### Money

Semua nilai uang menggunakan integer Rupiah.

Contoh:

```text
15000 = Rp15.000
250000 = Rp250.000
```

Jangan menggunakan FLOAT/DOUBLE untuk nilai uang.

### Perubahan dari ERD sebelumnya

Field:

```text
stock
```

DIHAPUS dari `products`.

Stock dipindahkan ke entity `Product Stock` karena satu product dapat memiliki stok berbeda di setiap outlet.

---

# 8. Product Stock

Merepresentasikan jumlah stok sebuah product pada outlet tertentu.

### Fields

- `id`: UUID PK
- `tenant_id`: UUID FK → `tenants.id`
- `outlet_id`: UUID FK → `outlets.id`
- `product_id`: UUID FK → `products.id`
- `quantity`: INTEGER
- `minimum_stock`: INTEGER NULL
- `created_at`: TIMESTAMP
- `updated_at`: TIMESTAMP

### Relationships

```text
Tenant 1 ─── N Product Stock
Outlet 1 ─── N Product Stock
Product 1 ─── N Product Stock
```

### Constraint

```text
UNIQUE(outlet_id, product_id)
```

Satu product hanya memiliki satu record stok pada satu outlet.

### Contoh

```text
Product: Coca Cola

Outlet A → quantity = 20
Outlet B → quantity = 5
Outlet C → quantity = 12
```

Dengan model ini, KasirKita sudah siap berkembang ke multi-outlet.

---

# 9. Transaction

Merepresentasikan transaksi penjualan.

### Fields

- `id`: UUID PK
- `tenant_id`: UUID FK → `tenants.id`
- `outlet_id`: UUID FK → `outlets.id`
- `cashier_id`: UUID FK → `users.id`
- `subtotal`: INTEGER
- `tax`: INTEGER
- `discount`: INTEGER
- `total`: INTEGER
- `status`: ENUM
- `client_transaction_id`: UUID
- `created_at`: TIMESTAMP
- `updated_at`: TIMESTAMP

### Suggested Status

```text
PENDING
COMPLETED
CANCELLED
VOID
```

### Relationships

```text
Outlet 1 ─── N Transaction
User 1 ─── N Transaction
Transaction 1 ─── N Transaction Item
Transaction 1 ─── N Payment
```

### Offline Synchronization

`client_transaction_id` digunakan sebagai identifier transaksi dari device.

Contoh:

```text
Android
   ↓
client_transaction_id = UUID-123
   ↓
Internet tersedia
   ↓
Backend menerima transaksi
   ↓
Server memastikan UUID belum pernah diproses
   ↓
Transaction dibuat
```

Backend harus memiliki unique constraint pada `client_transaction_id` dalam scope yang sesuai sehingga retry tidak menghasilkan transaksi duplikat.

---

# 10. Transaction Item

Merepresentasikan detail produk yang dibeli dalam sebuah transaksi.

### Fields

- `id`: UUID PK
- `transaction_id`: UUID FK → `transactions.id`
- `product_id`: UUID FK → `products.id`
- `quantity`: INTEGER
- `unit_price`: INTEGER
- `unit_cost`: INTEGER
- `subtotal`: INTEGER
- `created_at`: TIMESTAMP

### Relationships

```text
Transaction 1 ─── N Transaction Item
Product 1 ─── N Transaction Item
```

### Important Rules

`unit_price` adalah snapshot harga ketika transaksi terjadi.

`unit_cost` juga disimpan sebagai snapshot cost ketika transaksi terjadi.

Contoh:

```text
Product saat ini:

price = 15000
cost = 10000
```

Transaksi:

```text
unit_price = 15000
unit_cost  = 10000
```

Jika kemudian harga product berubah menjadi:

```text
price = 17000
cost = 11000
```

transaksi lama tetap menggunakan:

```text
unit_price = 15000
unit_cost  = 10000
```

Ini penting untuk historical reporting dan perhitungan gross profit.

---

# 11. Payment

Merepresentasikan pembayaran sebuah transaksi.

### Fields

- `id`: UUID PK
- `transaction_id`: UUID FK → `transactions.id`
- `method`: ENUM
- `status`: ENUM
- `amount`: INTEGER
- `provider`: VARCHAR NULL
- `provider_reference`: VARCHAR NULL
- `paid_at`: TIMESTAMP NULL
- `created_at`: TIMESTAMP
- `updated_at`: TIMESTAMP

### Payment Method

V1:

```text
CASH
QRIS
E_WALLET
```

Metode lain dapat ditambahkan kemudian.

### Payment Status

```text
PENDING
PAID
FAILED
EXPIRED
CANCELLED
```

### Relationships

```text
Transaction 1 ─── N Payment
```

### Rules

Client tidak boleh menentukan status pembayaran sebagai `PAID` secara sepihak.

Untuk payment provider:

```text
Payment Request
      ↓
Provider
      ↓
Provider verification / callback
      ↓
Backend
      ↓
Payment = PAID
```

---

# 12. Stock Movement

Merepresentasikan ledger/audit trail seluruh perubahan stok.

### Fields

- `id`: UUID PK
- `tenant_id`: UUID FK → `tenants.id`
- `outlet_id`: UUID FK → `outlets.id`
- `product_id`: UUID FK → `products.id`
- `user_id`: UUID FK → `users.id`
- `type`: ENUM
- `quantity`: INTEGER
- `reference_type`: VARCHAR NULL
- `reference_id`: UUID NULL
- `reason`: TEXT NULL
- `created_at`: TIMESTAMP

### Movement Type

```text
SALE
PURCHASE
ADJUSTMENT
RETURN
VOID
```

### Quantity Convention

`quantity` menyimpan nilai perubahan stok dengan tanda.

Contoh:

```text
SALE       → -2
PURCHASE   → +10
ADJUSTMENT → +5
RETURN     → +1
VOID       → +2
```

Dengan demikian movement dapat diperlakukan sebagai ledger.

### Relationships

```text
Product 1 ─── N Stock Movement
Outlet 1 ─── N Stock Movement
User 1 ─── N Stock Movement
```

---

# 13. Stock Adjustment

Merepresentasikan aksi user untuk melakukan penyesuaian stok secara manual.

### Fields

- `id`: UUID PK
- `tenant_id`: UUID FK → `tenants.id`
- `outlet_id`: UUID FK → `outlets.id`
- `product_id`: UUID FK → `products.id`
- `user_id`: UUID FK → `users.id`
- `type`: ENUM
- `quantity`: INTEGER
- `reason`: TEXT
- `created_at`: TIMESTAMP

### Type

```text
ADD
DEDUCT
```

### Flow

Stock Adjustment bukan ledger utama.

Flow-nya:

```text
User
  ↓
Stock Adjustment
  ↓
Update Product Stock
  ↓
Create Stock Movement
```

Contoh:

```text
Adjustment
ADD 10 Coca Cola

        ↓

Product Stock
quantity +10

        ↓

Stock Movement
type = ADJUSTMENT
quantity = +10
```

Dengan demikian `Stock Adjustment` menyimpan aksi bisnis, sedangkan `Stock Movement` menjadi audit trail.

---

# 14. Relationships

Relationship utama:

```text
Tenant
 │
 ├──< Users
 │
 ├──< Outlets
 │      │
 │      ├──< Product Stocks
 │      ├──< Transactions
 │      └──< Stock Movements
 │
 ├──< Categories
 │      │
 │      └──< Products
 │               │
 │               ├──< Product Stocks
 │               ├──< Transaction Items
 │               └──< Stock Movements
 │
 └──< Products
```

Transaction:

```text
Transaction
 │
 ├──< Transaction Items
 │        │
 │        └──> Product
 │
 └──< Payments
```

Stock:

```text
Product
   │
   └──< Product Stock
           │
           └──> Outlet


Product
   │
   └──< Stock Movement
           │
           ├──> Outlet
           └──> User
```

Adjustment:

```text
Stock Adjustment
       │
       ├──> Product
       ├──> Outlet
       └──> User
              │
              ↓
       Stock Movement
```

---

# 15. Tenant Isolation

Semua entity tenant-scoped harus selalu berada dalam tenant yang sama.

Contoh:

```text
Transaction
tenant_id = A
outlet_id = outlet_A
```

Tidak boleh:

```text
Transaction
tenant_id = A
outlet_id = outlet_B
```

jika `outlet_B` milik tenant B.

Backend harus mengambil tenant dari authenticated user/JWT dan tidak mempercayai `tenant_id` yang dikirim client.

---

# 16. V1 Product Variant Decision

Product Variant **tidak termasuk ERD V1**.

Alasannya:

- Belum menjadi requirement inti V1.
- Business rule variant belum ditentukan.
- Stock variant membutuhkan desain inventory tambahan.
- Transaction item harus mengetahui variant yang dipilih.
- Menambahkan variant sekarang akan memperbesar kompleksitas database tanpa kebutuhan yang jelas.

Jika dibutuhkan di fase berikutnya, model dapat dikembangkan menjadi:

```text
Product
   │
   └──< Product Variant
             │
             └──< Product Stock
```

dan `transaction_items` dapat memiliki `variant_id`.

---

# 17. Reporting

Tidak diperlukan tabel `reports` khusus untuk V1.

Data laporan dapat dihitung dari:

```text
Transaction
Transaction Item
Payment
Product
Product Stock
Stock Movement
```

Contoh Gross Profit:

```text
Gross Profit
= Sales
- COGS
```

COGS dapat dihitung berdasarkan:

```text
Transaction Item
quantity × unit_cost
```

Karena `unit_cost` disimpan sebagai historical snapshot.

---

# 18. Final Entity List

```text
1.  tenants
2.  outlets
3.  users
4.  categories
5.  products
6.  product_stocks
7.  transactions
8.  transaction_items
9.  payments
10. stock_movements
11. stock_adjustments
```

## Deferred Entities

Tidak termasuk V1:

```text
product_variants
customers
suppliers
purchases
expenses
cashier_shifts
promotions
discount_rules
```

Entity tersebut dapat ditambahkan setelah requirement dan business rules sudah jelas.

---

# 19. Final V1 Relationship Summary

```text
Tenant
 ├── 1:N User
 ├── 1:N Outlet
 ├── 1:N Category
 └── 1:N Product

Outlet
 ├── 1:N User
 ├── 1:N Product Stock
 ├── 1:N Transaction
 ├── 1:N Stock Movement
 └── 1:N Stock Adjustment

Category
 └── 1:N Product

Product
 ├── 1:N Product Stock
 ├── 1:N Transaction Item
 └── 1:N Stock Movement

Transaction
 ├── 1:N Transaction Item
 └── 1:N Payment

Stock Adjustment
 └── generates Stock Movement
```

# 20. ERD V1 Status

**STATUS: FINAL V1 — READY FOR DATABASE DESIGN**

Tahap berikutnya adalah menurunkan model ini menjadi:

```text
ERD Final V1
     ↓
PostgreSQL Schema
     ↓
Database Constraints
     ↓
Indexes
     ↓
Migrations
```

Jangan menambahkan entity baru ke database hanya karena "mungkin nanti dibutuhkan". Entity baru harus berasal dari requirement atau business rule yang sudah jelas.