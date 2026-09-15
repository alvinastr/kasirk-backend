# KasirKita POS - Project Status

## Project Overview

KasirKita adalah aplikasi Point of Sales (POS) multi-tenant.

Target MVP: - Android mobile app untuk kasir - Backend API menggunakan
NestJS - Database PostgreSQL menggunakan Prisma ORM - Authentication
menggunakan JWT - Support multi outlet - Inventory management -
Transaction management

------------------------------------------------------------------------

# Tech Stack

## Backend

  Komponen         Teknologi
  ---------------- ------------------------------------
  Framework        NestJS
  Language         TypeScript
  ORM              Prisma ORM
  Database         PostgreSQL
  Authentication   Passport JWT
  Validation       class-validator, class-transformer

## Planned Frontend

  Platform        Teknologi
  --------------- ----------------
  Mobile          Kotlin Android
  Web Dashboard   Next.js

------------------------------------------------------------------------

# Architecture

Backend structure:

    src
    ├── auth
    ├── categories
    ├── products
    ├── outlets
    ├── users
    ├── stock
    ├── prisma
    ├── common
    └── app.module.ts

Architecture pattern:

    Controller
        |
        v
    Service
        |
        v
    Prisma ORM
        |
        v
    PostgreSQL

------------------------------------------------------------------------

# Database Status

Database menggunakan Prisma ORM.

File:

    prisma/schema.prisma

## Completed Models

### Tenant

Status: ✅ Done

Purpose: Menyimpan data toko/company.

### Outlet

Status: ✅ Done

Purpose: Menyimpan cabang toko.

### Category

Status: ✅ Done

Purpose: Kategori produk.

### Product

Status: ✅ Done

Purpose: Master produk.

### User

Status: ✅ Done

Roles:

-   OWNER
-   ADMIN
-   CASHIER

### Stock

Status: ✅ Done

Models:

-   product_stocks
-   stock_adjustments
-   stock_movements

### Transaction Database Layer

Status: ✅ Completed

Implemented:

-   Prisma schema
-   transaction tables
-   transaction_items
-   payments
-   tenant integrity
-   migration tested

------------------------------------------------------------------------

# Current Database Schema Summary

## Database Relationship Summary

    Tenant
    |
    ├── Users
    |
    ├── Outlets
    |
    ├── Categories
    |
    ├── Products
    |
    ├── Transactions

    Outlet
    |
    ├── Product Stocks
    |
    ├── Transactions

    Product
    |
    ├── Product Stocks
    |
    ├── Transaction Items
    |
    ├── Stock Movements

    Transaction
    |
    ├── Transaction Items
    |
    ├── Payments

------------------------------------------------------------------------

# Transaction Database Fields

## transactions

Fields:

-   id UUID
-   tenant_id UUID
-   outlet_id UUID
-   user_id UUID
-   client_transaction_id UUID
-   status
-   subtotal BIGINT
-   discount BIGINT
-   tax BIGINT
-   total BIGINT
-   created_at
-   updated_at

## transaction_items

Fields:

-   id
-   transaction_id
-   product_id
-   quantity
-   unit_price
-   unit_cost
-   subtotal

## payments

Fields:

-   id
-   transaction_id
-   method
-   status
-   amount
-   provider
-   paid_at

------------------------------------------------------------------------

# Completed Modules

### Stock Module ✅

Implemented:

- GET stock by outlet
- Stock adjustment
- ADD stock
- DEDUCT stock
- Stock validation
- Negative stock protection
- Tenant ownership validation
- Atomic stock update

Verified:

- Create stock success
- Increase stock success
- Decrease stock success
- Insufficient stock rejected

------------------------------------------------------------------------

## Transaction Module Status

Status:
✅ Completed MVP

Implemented:
- Transaction checkout
- Transaction items snapshot
- CASH payment
- Change calculation
- Optional tax configuration
- Stock deduction after sale
- Stock movement SALE
- Idempotency protection
- Transaction rollback

Verified:
- Successful checkout
- Insufficient payment rejection
- Stock deduction
- Duplicate request handling
- Transaction listing

------------------------------------------------------------------------

## RBAC Authorization Module

Status:

✅ Completed

Implemented:

- Roles decorator
- RolesGuard
- Role-based endpoint protection
- ForbiddenException handling

Roles:

- OWNER
- ADMIN
- CASHIER

Protected Endpoints:

| Endpoint | Allowed Role |
| --- | --- |
| POST /users | OWNER |
| POST /outlets | OWNER |
| POST /products | OWNER, ADMIN |
| POST /categories | OWNER, ADMIN |
| POST /stock/adjustment | OWNER, ADMIN |
| POST /transactions | OWNER, ADMIN, CASHIER |

Verification:

- RBAC integration test: 9/9 passed
- Build passed
- TypeScript passed
- Lint passed

Notes:

GET endpoints still follow existing access rules.
JWT authentication and tenant isolation unchanged.

------------------------------------------------------------------------

# Authentication Status

Status:

✅ Completed

Endpoint:

    POST /auth/login

Request:

``` json
{
  "email": "owner@kasirkita.com",
  "password": "password123",
  "tenant_id": "tenant_uuid"
}
```

JWT Payload:

``` json
{
  "sub": "user_id",
  "tenant_id": "tenant_id",
  "role": "OWNER"
}
```

Protected routes menggunakan:

``` typescript
@UseGuards(JwtGuard)
```

------------------------------------------------------------------------

# Module Progress

## Auth Module

Status:

✅ Completed

Features:

-   Login
-   JWT generation
-   JWT validation
-   Current user decorator

------------------------------------------------------------------------

## Users Module

Status:

✅ Completed

Endpoints:

    GET /users
    POST /users

Security:

-   password_hash tidak dikembalikan pada response

------------------------------------------------------------------------

## Category Module

Status:

✅ Completed

Endpoints:

    GET /categories
    POST /categories

------------------------------------------------------------------------

## Product Module

Status:

✅ Completed

Endpoints:

    GET /products
    POST /products

------------------------------------------------------------------------

## Outlet Module

Status:

✅ Completed

Endpoints:

    GET /outlets
    POST /outlets

------------------------------------------------------------------------

## Stock Module

Status:

✅ Completed (Hardening Done)

Base route:

    /stock

Endpoints:

### Get Stock By Outlet

    GET /stock/:outlet_id

Authentication:

    Authorization: Bearer JWT_TOKEN

### Create Stock Adjustment

    POST /stock/adjustment

Request:

``` json
{
  "outlet_id": "uuid",
  "product_id": "uuid",
  "adjustment_type": "ADD",
  "quantity": 10,
  "reason": "Restock"
}
```

Supported:

-   ADD
-   DEDUCT

Implemented:

✅ JWT user context menggunakan `sub`

✅ Tenant ownership validation

✅ Atomic stock update

✅ Prisma transaction

✅ Concurrent stock safety

✅ Stock movement logging

------------------------------------------------------------------------

# API Endpoint Current

## Auth

    POST /auth/login
    GET /auth/me

## Users

    GET /users
    POST /users

## Categories

    GET /categories
    POST /categories

## Products

    GET /products
    POST /products

## Outlets

    GET /outlets
    POST /outlets

## Stock

    GET /stock/:outlet_id
    POST /stock/adjustment

------------------------------------------------------------------------

# Security Hardening Status

Status:

✅ Completed

Implemented:

## JWT Context

Standard payload:

``` json
{
  "sub": "user_id",
  "tenant_id": "tenant_id",
  "role": "OWNER"
}
```

## Tenant Isolation

Semua business query wajib menggunakan:

    tenant_id

Validation:

-   Product ownership
-   Category ownership
-   Outlet ownership
-   User ownership

## Stock Safety

Protection:

-   Rollback ketika gagal
-   Prevent invalid stock reduction
-   Safe concurrent update

## User Security

Response API tidak mengandung:

    password_hash

------------------------------------------------------------------------

# Git Progress

Completed:

-   Initial NestJS setup
-   Prisma PostgreSQL setup
-   Tenant module
-   Category module
-   Product module
-   Outlet module
-   User module
-   Auth JWT module
-   Stock module
-   Backend hardening

------------------------------------------------------------------------

# Remaining Roadmap

## Phase 1 - Backend Hardening

\[x\] JWT Authentication

\[x\] Tenant isolation

\[x\] Stock safety

\[ \] JWT Secret environment configuration

\[ \] RBAC Permission System

------------------------------------------------------------------------

## Phase 2 - Business Logic

\[ \] Transaction Module

\[ \] Payment Module

\[ \] Stock deduction after transaction

\[ \] Receipt generation

\[ \] Daily sales report

\[ \] Dashboard API

------------------------------------------------------------------------

## Phase 3 - Frontend

Android:

\[ \] Login

\[ \] Product list

\[ \] Cart

\[ \] Checkout

\[ \] Transaction history

Dashboard:

\[ \] Next.js admin panel

------------------------------------------------------------------------

# Transaction Status Enum

Transaction Status:

-   PENDING
-   PAID
-   CANCELLED

Payment Status:

-   PENDING
-   SUCCESS
-   FAILED

------------------------------------------------------------------------

# Transaction API

## Create Transaction

    POST /transactions

Request:

``` json
{
    "outlet_id": "",
    "items": [
        {
            "product_id": "",
            "quantity": 2
        }
    ],
    "payment": {
        "method": "CASH",
        "amount": 50000
    }
}
```

Response:

``` json
{
    "transaction_id": "",
    "total": 30000,
    "status": "PAID"
}
```

------------------------------------------------------------------------

# Transaction Business Rules

Transaction flow:

1. Cashier creates transaction
2. System validates outlet ownership
3. System validates product availability
4. System calculates subtotal
5. System creates transaction_items
6. System decreases stock
7. System creates stock_movements
8. System creates payment record

Transaction must support:

-   Multiple products
-   Quantity calculation
-   Discount
-   Tax
-   Payment status
-   Receipt data

------------------------------------------------------------------------

# Transaction Implementation Rule

Transaction creation MUST be atomic.

All operations:

-   Transaction creation
-   Transaction items creation
-   Stock deduction
-   Stock movement
-   Payment creation

must happen inside one Prisma transaction.

Any failure must rollback all changes.

------------------------------------------------------------------------

# Known Issues

-   JWT secret masih hardcoded
-   RBAC belum implemented
-   Swagger documentation belum dibuat
-   Unit test belum lengkap

------------------------------------------------------------------------

# Current Focus

Priority:

1.  Complete Transaction Module
2.  Implement Payment Module
3.  Add Transaction Stock Integration
4.  Add RBAC Permission System
5.  Move JWT Secret to Environment Variable
6.  Finalize API Documentation

------------------------------------------------------------------------

# Instruction For AI Coding Assistant

Before modifying code, understand:

-   This is a multi tenant POS system
-   Every business table uses tenant_id
-   Authentication uses JWT
-   Prisma is the database layer
-   Business logic belongs in Service
-   Follow existing NestJS module structure

Do not:

-   Remove tenant isolation
-   Bypass authentication
-   Put business logic inside Controller

When creating new module:

    module
    ├── controller
    ├── service
    ├── dto
    └── module.ts

# Development Rules

Every new module MUST:

-   Use JWT authentication
-   Validate tenant ownership
-   Use DTO validation
-   Use Prisma transaction for multi-table changes
-   Return clean API response
-   Handle Prisma errors

Never:

-   Direct Prisma query inside Controller
-   Hardcode tenant_id
-   Trust client tenant_id without validation
-   Return password_hash

Always provide:

-   DTO validation
-   Prisma query
-   Error handling
-   API endpoint example
-   Testing instruction
