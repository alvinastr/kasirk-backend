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

### Transaction

Status: ⏳ Not Implemented

Planned:

-   transactions
-   transaction_items
-   payments

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

# Current Focus

Priority:

1.  Move JWT secret to environment variable
2.  Implement RBAC authorization
3.  Finalize API specification
4.  Start Transaction Module

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

Always provide:

-   DTO validation
-   Prisma query
-   Error handling
-   API endpoint example
-   Testing instruction
