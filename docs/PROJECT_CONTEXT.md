# KasirKita POS — Project Context

> **Purpose:** This document is the single project-context reference for AI coding agents working on KasirKita POS.  
> **Status:** Draft / Development Baseline  
> **Product:** KasirKita POS  
> **Architecture:** Android POS + Web Dashboard + REST API + PostgreSQL

---

## 1. Project Overview

KasirKita POS is a cloud-based Point of Sale system designed for Indonesian UMKM.

The product combines:

- A mobile POS application for cashier/store operations.
- A web dashboard for owners, managers, and administrators.
- A centralized REST API.
- PostgreSQL as the central database.
- Local SQLite storage on Android for offline operation.

The product is planned incrementally so that the MVP can be delivered early and expanded toward multi-outlet operation.

### Product objectives

1. Provide a stable POS system that can continue operating with limited internet connectivity.
2. Digitize stock recording and financial reporting.
3. Provide near-real-time sales and stock information.
4. Support growth from a single store to multiple outlets.
5. Keep the architecture simple, affordable, maintainable, and scalable.

### Main user groups

#### Cashier / Store Staff

Uses the Android POS application.

Needs:

- Fast product selection.
- Fast cart and checkout.
- Minimal calculation errors.
- Touch-friendly UI.
- Ability to continue selling during temporary internet outages.

The cashier should not need access to sensitive business information such as cost price or overall profit/loss unless explicitly authorized.

#### Owner / Manager / Admin

Primarily uses the web dashboard.

Needs:

- Remote sales monitoring.
- Product and category management.
- Stock management.
- Financial reporting.
- Profit/loss visibility.
- Employee and access management.
- Multi-outlet management in later phases.

---

# 2. Product Requirements

The product requirements below are derived from the current KasirKita POS PRD.

## Phase 1 — Core POS

### Epic: Cashier Transactions

The mobile application must support:

- Fast product selection.
- Product grid with name and image.
- Cart management.
- Quantity changes.
- Subtotal calculation.
- Tax calculation when applicable.
- Cash received input.
- Automatic change calculation.
- Checkout and transaction recording.

---

## Phase 2 — Independent Store Operations & Digital Payments

### Epic: Offline Mode

The Android POS must support:

- Processing transactions while offline.
- Saving transactions locally.
- Automatic synchronization when the connection returns.
- A visible online/offline connection indicator.

### Epic: Products & Stock

The system must support:

- Product CRUD.
- Category assignment.
- Cost price.
- Selling price.
- Stock management.
- Automatic stock deduction after a successful sale.
- Manual stock-in/stock-out records.
- Stock history.

### Epic: Reports

The web dashboard must support:

- Daily sales.
- Cash-flow information.
- Visual sales dashboard.
- Gross profit / loss.
- Gross margin calculation.

Gross profit is based on:

```text
Total Sales - Total Cost of Products Sold
```

### Epic: Digital Payments

The system is planned to support:

- QRIS.
- E-wallet payment methods.
- Dynamic QR codes.
- Payment status:
  - SUCCESS
  - FAILED
  - PENDING
- Payment history.

### Epic: Hardware

The Android application is planned to support:

- Bluetooth thermal printers.
- USB thermal printers.
- Print-test functionality.
- Automatic receipt printing.
- External barcode scanners.

---

## Phase 4 — Business Scalability

### Epic: Multi-Outlet

The system must eventually support:

- Multiple store locations.
- Outlet-specific sales filtering.
- Outlet-specific operations.

### Epic: Employees & RBAC

The system must eventually support:

- Employee accounts.
- Roles.
- Permissions.
- Restrictions based on role and outlet.

Example:

```text
Cashier Outlet A
→ Can process sales
→ Cannot change product prices

Manager
→ Can access broader management functionality
```

### Epic: Authentication & Tenant Registration

The system must eventually support:

- Login.
- Logout.
- Password recovery.
- Email/phone authentication.
- New tenant/business registration.

---

# 3. Non-Functional Requirements

## API-first

The system uses a RESTful API so that Android and Web clients consume the same backend.

```text
Android ─┐
         ├── REST API ── Backend ── PostgreSQL
Web ─────┘
```

## Performance

Target API latency:

```text
< 500 ms
```

for normal operations where practical.

Performance should not be optimized prematurely. Correctness and data integrity come first.

## Reliability

Offline synchronization must be able to handle multiple devices and queued transactions.

The synchronization mechanism must account for:

- Retries.
- Network failures.
- Duplicate requests.
- Idempotency.
- Partial failures.
- Synchronization state.

## Security

API endpoints must use JWT-based authentication.

Multi-tenant data must be strictly isolated.

A user belonging to Tenant A must never be able to read or modify Tenant B data.

---

# 4. Technology Stack

## Android POS

| Technology | Purpose |
|---|---|
| Kotlin | Main language |
| Jetpack Compose | UI |
| Android Jetpack | Application architecture |
| Room | Local SQLite database |
| Retrofit | HTTP/REST client |
| Kotlin Coroutines | Async operations |
| Android Native APIs | Hardware integration |

Recommended Android architecture:

```text
UI
 ↓
ViewModel
 ↓
Use Case / Domain
 ↓
Repository
 ↓
Local Data Source / Remote Data Source
```

---

## Backend

| Technology | Purpose |
|---|---|
| NestJS | Backend framework |
| TypeScript | Main language |
| REST API | Client-server communication |
| PostgreSQL | Central database |
| JWT | Authentication |
| Queue | Offline synchronization/background jobs |
| Redis | Optional cache/queue infrastructure when needed |

The backend should start as a **modular monolith**, not microservices.

---

## Web Dashboard

| Technology | Purpose |
|---|---|
| Next.js | Web framework |
| TypeScript | Main language |
| React | UI |
| REST API | Backend communication |

The Web Dashboard must not access PostgreSQL directly.

```text
Next.js
   ↓
NestJS REST API
   ↓
PostgreSQL
```

---

## Payment

Planned payment gateway options:

- Midtrans
- Xendit
- OY!

Payment integration must be abstracted behind a service/provider boundary so the provider can be changed later.

---

## Infrastructure

Possible cloud infrastructure:

- Supabase.
- AWS.
- Google Cloud.

Initial infrastructure should favor low cost and simplicity.

Do not introduce Kubernetes, microservices, Kafka, or other heavyweight infrastructure without an actual requirement.

---

# 5. System Architecture

Target architecture:

```text
                    ┌─────────────────────────┐
                    │   Next.js Web Dashboard │
                    └────────────┬────────────┘
                                 │
                                 │ REST API
                                 ▼
┌─────────────────────────┐   ┌──────────────────────┐
│ Android POS             │   │ NestJS Backend       │
│ Kotlin + Compose        │──▶│ TypeScript           │
│                         │   │                      │
│ Room / SQLite           │   │ REST API             │
│ Retrofit                │   │ JWT Authentication   │
│ Offline Sync            │   │ Business Logic       │
└─────────────────────────┘   └──────────┬───────────┘
                                         │
                                         ▼
                                ┌──────────────────┐
                                │   PostgreSQL     │
                                └──────────────────┘
```

Optional infrastructure:

```text
NestJS
 ├── Redis
 │    ├── Cache
 │    └── Queue
 │
 └── Background Worker
      └── Offline Sync / Jobs
```

Redis should be introduced only when the application actually needs it.

---

# 6. Backend Module Architecture

Recommended NestJS modules:

```text
src/
├── auth/
├── users/
├── tenants/
├── outlets/
├── categories/
├── products/
├── transactions/
├── payments/
├── stock/
├── reports/
├── sync/
└── common/
```

A module should generally contain only the layers it actually needs:

```text
module/
├── controller
├── service
├── dto
├── entity/model
├── repository
└── tests
```

Do not create empty or unnecessary abstractions just to follow a template.

---

# 7. ERD — Baseline Data Model

The following is the current baseline ERD for the project. It is intentionally focused on the MVP/core domain and can be extended as requirements become clearer.

## Tenant

```text
tenants
---------
id              UUID PK
name            VARCHAR
address         TEXT
tax_rate        INTEGER
is_active       BOOLEAN
created_at      TIMESTAMP
updated_at      TIMESTAMP
```

A tenant represents a business/customer using KasirKita.

---

## Outlet

```text
outlets
---------
id              UUID PK
tenant_id       UUID FK → tenants.id
name            VARCHAR
address         TEXT
is_active       BOOLEAN
created_at      TIMESTAMP
updated_at      TIMESTAMP
```

An outlet belongs to exactly one tenant.

Multi-outlet support is part of the later scalability phase.

---

## User

```text
users
---------
id              UUID PK
tenant_id       UUID FK → tenants.id
outlet_id       UUID FK → outlets.id NULL
name            VARCHAR
email           VARCHAR
password_hash   VARCHAR
role            ENUM
is_active       BOOLEAN
created_at      TIMESTAMP
updated_at      TIMESTAMP
```

Initial roles:

```text
OWNER
ADMIN
CASHIER
```

Authorization must be enforced by the backend.

---

## Category

```text
categories
---------
id              UUID PK
tenant_id       UUID FK → tenants.id
name            VARCHAR
created_at      TIMESTAMP
updated_at      TIMESTAMP
```

A category belongs to one tenant.

---

## Product

```text
products
---------
id              UUID PK
tenant_id       UUID FK → tenants.id
category_id     UUID FK → categories.id
name            VARCHAR
sku             VARCHAR
price           INTEGER
cost            INTEGER
stock           INTEGER
minimum_stock   INTEGER
is_active       BOOLEAN
created_at      TIMESTAMP
updated_at      TIMESTAMP
```

Money values should normally be stored as integers representing IDR.

Example:

```text
15000 = Rp15.000
```

Historical transaction prices must be stored in transaction items and must not depend on the current product price.

---

## Product Variant

```text
product_variants
---------
id              UUID PK
product_id      UUID FK → products.id
name            VARCHAR
price           INTEGER
stock           INTEGER
created_at      TIMESTAMP
updated_at      TIMESTAMP
```

Variants belong to a product.

The exact variant business rules should be finalized before implementation if variants become part of the first release.

---

## Transaction

```text
transactions
---------
id                  UUID PK
tenant_id           UUID FK → tenants.id
outlet_id           UUID FK → outlets.id
cashier_id          UUID FK → users.id
subtotal             INTEGER
tax                  INTEGER
discount             INTEGER
total                INTEGER
status               ENUM
client_transaction_id UUID NULL
created_at           TIMESTAMP
updated_at           TIMESTAMP
```

Transaction IDs should support offline operation.

A UUID/client-generated transaction identifier can be used to provide idempotent synchronization.

---

## Transaction Item

```text
transaction_items
---------
id              UUID PK
transaction_id  UUID FK → transactions.id
product_id      UUID FK → products.id
quantity        INTEGER
unit_price      INTEGER
subtotal        INTEGER
created_at      TIMESTAMP
```

`unit_price` is a historical snapshot.

If the product price changes later, existing transactions must remain unchanged.

---

## Payment

```text
payments
---------
id                  UUID PK
transaction_id      UUID FK → transactions.id
method              ENUM
status              ENUM
amount              INTEGER
provider             VARCHAR NULL
provider_reference   VARCHAR NULL
paid_at              TIMESTAMP NULL
created_at           TIMESTAMP
updated_at           TIMESTAMP
```

Payment statuses should represent the actual payment state.

Do not allow the client to arbitrarily mark a payment as successful without backend/provider verification.

---

## Stock Movement

```text
stock_movements
---------
id              UUID PK
tenant_id       UUID FK → tenants.id
outlet_id       UUID FK → outlets.id
product_id      UUID FK → products.id
user_id         UUID FK → users.id
type            ENUM
quantity        INTEGER
reference_type VARCHAR NULL
reference_id    UUID NULL
reason          TEXT NULL
created_at      TIMESTAMP
```

Possible movement types:

```text
SALE
PURCHASE
ADJUSTMENT
RETURN
VOID
```

Stock changes should be auditable.

---

## Stock Adjustment

```text
stock_adjustments
---------
id              UUID PK
tenant_id       UUID FK → tenants.id
outlet_id       UUID FK → outlets.id
product_id      UUID FK → products.id
user_id         UUID FK → users.id
type            ENUM
quantity        INTEGER
reason          TEXT
created_at      TIMESTAMP
```

Possible adjustment types:

```text
ADD
DEDUCT
```

A stock adjustment should also result in an auditable stock movement where appropriate.

---

# 8. ERD Relationships

Conceptual relationships:

```text
Tenant
 │
 ├──< Users
 │
 ├──< Outlets
 │      │
 │      ├──< Transactions
 │      └──< Stock Movements
 │
 ├──< Categories
 │      │
 │      └──< Products
 │              │
 │              └──< Product Variants
 │
 └──< Transactions
        │
        ├──< Transaction Items >── Products
        │
        └──< Payments
```

Important relationship rules:

```text
Tenant 1 ── N Users
Tenant 1 ── N Outlets
Tenant 1 ── N Categories
Tenant 1 ── N Products
Category 1 ── N Products
Product 1 ── N Product Variants
Outlet 1 ── N Transactions
Transaction 1 ── N Transaction Items
Transaction 1 ── N Payments
Product 1 ── N Stock Movements
```

The exact database implementation may evolve after detailed schema design.

---

# 9. Multi-Tenant Rules

Tenant isolation is a security requirement.

Never trust a client-provided `tenant_id`.

Bad:

```json
{
  "tenant_id": "another-tenant-id"
}
```

The backend must derive tenant context from the authenticated user.

Every tenant-scoped query must enforce tenant isolation.

Example:

```text
Authenticated User
        ↓
JWT
        ↓
tenant_id
        ↓
Service
        ↓
Repository
        ↓
WHERE tenant_id = authenticatedTenantId
```

Never allow:

```text
User A → Tenant B data
```

even if the client knows the database ID.

---

# 10. Transaction & Stock Integrity

A sale should not create inconsistent data.

Bad state:

```text
Transaction created
+
Stock not deducted
```

or:

```text
Stock deducted
+
Transaction not created
```

Operations that must remain consistent should use database transactions where appropriate.

Example:

```text
Create Transaction
       ↓
Create Transaction Items
       ↓
Deduct Stock
       ↓
Create Stock Movement
       ↓
Create/Update Payment
       ↓
COMMIT
```

If a critical operation fails:

```text
ROLLBACK
```

unless there is an explicit recovery workflow.

---

# 11. Offline Synchronization

Offline flow:

```text
Android
  ↓
Room
  ↓
Local Transaction
  ↓
PENDING_SYNC
```

When online:

```text
PENDING_SYNC
     ↓
Sync Worker
     ↓
NestJS API
     ↓
Validate
     ↓
Check Idempotency
     ↓
Create/Update Server Transaction
     ↓
Return Result
     ↓
Mark Local Transaction as SYNCED
```

Possible local states:

```text
PENDING_SYNC
SYNCING
SYNCED
FAILED
```

The exact state machine can be refined during Android implementation.

---

# 12. Idempotency

Offline clients can retry requests.

Therefore, transaction synchronization must be idempotent.

Example:

```text
Client Transaction ID:
550e8400-e29b-41d4-a716-446655440000
```

First request:

```text
→ Transaction created
```

Retry:

```text
→ Existing transaction detected
→ Existing result returned
→ No duplicate sale created
```

Never create duplicate transactions because a network request was retried.

---

# 13. Authentication & Authorization

Use JWT for API authentication.

Authentication:

```text
Login
 ↓
Validate credentials
 ↓
Generate JWT
 ↓
Client stores token securely
 ↓
Client sends Authorization header
```

Passwords must never be stored in plain text.

The backend is the final authority for authorization.

Frontend restrictions are not sufficient.

For example:

```text
Hiding "Delete Product"
```

does not replace backend permission checking.

---

# 14. API Conventions

Use:

```text
/api/v1/
```

Example endpoints:

```text
POST   /api/v1/auth/login

GET    /api/v1/products
POST   /api/v1/products
GET    /api/v1/products/:id
PATCH  /api/v1/products/:id
DELETE /api/v1/products/:id

GET    /api/v1/categories
POST   /api/v1/categories

POST   /api/v1/transactions
GET    /api/v1/transactions/:id

POST   /api/v1/payments

GET    /api/v1/stock
POST   /api/v1/stock/adjustments

GET    /api/v1/reports/sales
GET    /api/v1/reports/profit-loss
```

Use standard HTTP methods and predictable response/error formats.

---

# 15. Money Rules

KasirKita operates in Indonesian Rupiah.

Use integer monetary values whenever possible.

Example:

```text
price = 15000
```

means:

```text
Rp15.000
```

Avoid floating-point arithmetic for financial calculations.

Transaction totals should be calculated consistently on the backend.

---

# 16. Payment Architecture

Do not tightly couple the transaction domain to Midtrans, Xendit, or another specific provider.

Prefer:

```text
PaymentService
      ↓
PaymentProvider Interface
      ↓
 ┌───────────┬───────────┐
 │ Midtrans  │ Xendit    │
 └───────────┴───────────┘
```

Business logic should depend on the abstraction, not directly on one provider.

---

# 17. Hardware Architecture

Printer and barcode integrations belong to the Android/hardware boundary.

Prefer:

```text
ReceiptPrinter
    ├── BluetoothPrinter
    └── USBPrinter
```

Transaction business logic should not contain Bluetooth/USB-specific implementation details.

Barcode scanning should translate hardware input into product lookup operations.

---

# 18. Development Phases

## V0.1 — Core POS

Implement:

- Authentication foundation.
- Tenant.
- User.
- Category.
- Product.
- Cart.
- Checkout.
- Transaction.
- Transaction items.
- Basic stock.

## V0.2 — Offline

Implement:

- Room.
- Offline transactions.
- Sync queue.
- Retry.
- Idempotency.
- Connection status.

## V0.3 — Dashboard

Implement:

- Sales dashboard.
- Daily sales.
- Stock reports.
- Cash flow.
- Basic P&L.

## V0.4 — Integrations

Implement:

- QRIS.
- Payment gateway.
- Thermal printer.
- Barcode scanner.

## V1.0 — Multi-Outlet

Implement:

- Multiple outlets.
- Employees.
- RBAC.
- Advanced reporting.
- Multi-outlet stock.

Do not implement later-phase features prematurely.

---

# 19. Coding Rules

## Rule 1 — Inspect Before Modifying

Before changing code:

1. Inspect the repository structure.
2. Inspect relevant existing files.
3. Inspect package/dependency configuration.
4. Inspect database schema/migrations.
5. Inspect existing API conventions.
6. Follow existing project patterns.

Do not assume the project is empty.

---

## Rule 2 — Plan Before Large Changes

For a significant feature, first explain:

```text
Understanding
↓
Affected modules/files
↓
Database impact
↓
API impact
↓
Implementation plan
↓
Testing strategy
↓
Risks
```

Then implement.

Small, isolated fixes may be implemented directly.

---

## Rule 3 — Minimal Changes

Modify only what is required.

Do not rewrite unrelated code.

Do not perform broad refactors while implementing a small feature.

---

## Rule 4 — No Invented Requirements

If a requirement is unclear:

- Make the smallest reasonable assumption.
- State the assumption.
- Avoid inventing complex business rules.

If the ambiguity could materially change the architecture, ask for clarification before implementation.

---

## Rule 5 — Backend Is the Authority

Never trust the client for:

- Tenant ID.
- User role.
- Payment status.
- Product price.
- Stock availability.
- Transaction total.
- Authorization.

Always validate critical business rules on the backend.

---

## Rule 6 — Keep Business Logic Out of Controllers

Controllers should primarily handle:

```text
HTTP request
→ validation
→ service call
→ HTTP response
```

Business logic belongs in services/domain/application layers.

---

## Rule 7 — Keep Business Logic Out of UI

Android and Next.js UI components should not contain large business rules.

Prefer:

```text
UI
 ↓
ViewModel / Hook
 ↓
Use Case / Service
```

---

## Rule 8 — Strong Typing

Use TypeScript types/interfaces/DTOs appropriately.

Avoid unnecessary:

```typescript
any
```

Prefer explicit types.

---

## Rule 9 — Validation

Validate all external input.

Validate:

- IDs.
- Prices.
- Quantities.
- Required fields.
- Permissions.
- Tenant ownership.
- Payment states.

---

## Rule 10 — Error Handling

Never silently swallow errors.

Bad:

```typescript
try {
  await operation();
} catch (error) {}
```

Instead:

- Handle expected failures.
- Log useful diagnostic information.
- Return safe client-facing errors.
- Do not leak secrets or internal stack traces.

---

## Rule 11 — Database Integrity

Use:

- Foreign keys.
- Constraints.
- Unique indexes where appropriate.
- Database transactions for atomic business operations.
- Migrations for schema changes.

Do not rely exclusively on application code for data integrity.

---

## Rule 12 — No Secrets in Git

Never commit:

```text
.env
passwords
JWT secrets
API keys
payment credentials
private keys
```

Maintain:

```text
.env.example
```

with placeholder values.

---

## Rule 13 — Testing

Prioritize tests for critical business logic:

- Transaction calculation.
- Tax.
- Discount.
- Stock deduction.
- Stock adjustment.
- Payment states.
- Authentication.
- Authorization.
- Tenant isolation.
- Offline synchronization.
- Idempotency.

High test coverage is less important than protecting critical behavior.

---

## Rule 14 — Git

Prefer small, meaningful commits.

Examples:

```text
feat: add product CRUD
feat: add transaction checkout
fix: prevent negative stock
fix: enforce tenant isolation
test: add transaction calculation tests
refactor: extract payment provider
```

Avoid meaningless commit messages.

---

## Rule 15 — Dependencies

Do not add a dependency unless it has a clear purpose.

Before adding one, consider:

- Is the functionality already available?
- Does the project really need it?
- Is the dependency maintained?
- Does it add unnecessary complexity?

---

## Rule 16 — Performance

Do not optimize without evidence.

Priority:

```text
Correctness
↓
Security
↓
Data Integrity
↓
Reliability
↓
Maintainability
↓
Performance
```

Use indexes, caching, Redis, queues, or more advanced infrastructure when there is a real need.

---

## Rule 17 — Destructive Operations

Never execute destructive operations without explicit confirmation.

Examples:

```text
DROP DATABASE
DROP TABLE
DELETE production data
Destructive migrations
Mass deletion
```

---

# 20. Documentation Rules

Important decisions should be documented.

Recommended:

```text
README.md

docs/
├── architecture.md
├── database.md
├── api.md
├── authentication.md
├── offline-sync.md
├── deployment.md
└── decisions/
```

Documentation should describe actual project behavior, not imagined future behavior.

---

# 21. AI Agent Operating Rules

When acting as an AI coding agent:

### Before coding

- Read this file.
- Inspect the repository.
- Identify the affected module.
- Check existing implementation.
- Check related migrations and tests.

### During coding

- Follow the architecture in this document.
- Keep changes focused.
- Reuse existing patterns.
- Do not silently change architecture.
- Do not add unnecessary dependencies.

### After coding

Run, where applicable:

```text
formatter
linter
type checker
unit tests
integration tests
migration/schema validation
build
```

Then review the final diff.

Report:

```text
What changed
Why it changed
Files affected
Tests/checks performed
Known limitations
```

---

# 22. Architecture Decision Principles

When there are multiple technical options, evaluate them using:

1. Correctness.
2. Security.
3. Data integrity.
4. Reliability.
5. Maintainability.
6. Development complexity.
7. Operational cost.
8. Scalability.

Prefer the simplest solution that satisfies the requirement.

Do not choose technology merely because:

- It is trendy.
- It is more complex.
- It is used by large companies.
- It sounds more scalable.

---

# 23. Current Architecture Summary

The current baseline is:

```text
Android
├── Kotlin
├── Jetpack Compose
├── Room / SQLite
├── Retrofit
└── Offline Sync

Web
├── Next.js
├── React
└── TypeScript

Backend
├── NestJS
├── TypeScript
├── REST API
├── JWT
└── Queue

Database
└── PostgreSQL

Optional Infrastructure
└── Redis

Payment
├── Midtrans
├── Xendit
└── OY!
```

---

# 24. Source of Product Requirements

The product requirements in this document are based on the current KasirKita POS PRD:

```text
Product Requirements Document (PRD)
KasirKita POS
Version 1.0 (Draft)
Status: Perencanaan (Fase 1–4)
```

The PRD defines the mobile POS + web dashboard architecture, product objectives, user personas, phased features, non-functional requirements, payment integrations, and cloud hosting/database considerations.

The ERD and technology-stack sections in this file are the project's current engineering baseline and may evolve as implementation decisions are finalized.

---

# 25. Golden Rule

The goal is not:

> "Make the code work as quickly as possible."

The goal is:

> "Build a reliable, secure, maintainable POS system using professional engineering practices while keeping the architecture simple and affordable."

Always follow:

```text
Simple
→ Reliable
→ Secure
→ Maintainable
→ Affordable
→ Scalable
```

Build incrementally.

Do not over-engineer.

Do not sacrifice data integrity for convenience.
