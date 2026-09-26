# KasirKita Auth V2 API Contract

**Status:** Target contract sebelum implementasi  
**Version:** 2.0-draft  
**Last updated:** 2026-09-26

Dokumen ini adalah sumber kontrak untuk migration schema, implementasi backend,
dan migrasi Android Auth V2. Endpoint Auth V2 di bawah ini belum tersedia sampai
fase backend selesai.

Urutan implementasi wajib:

```text
API contract (dokumen ini)
        ↓
schema migration
        ↓
backend endpoint
        ↓
Android migration
```

Auth V2 mengganti proses login harian dari `tenant_id + email + password`
menjadi pemilihan toko, pemilihan user, lalu PIN. Auth V2 tidak mengubah
tenant isolation, role bisnis, outlet authorization, atau cashier shift.

## 1. Compatibility dan scope

Endpoint legacy berikut tetap tersedia selama periode migrasi:

```http
POST /auth/login
GET /auth/me
```

Kontrak legacy `POST /auth/login` tetap menerima:

```json
{
  "tenant_id": "3ece59dc-9c6a-4fee-93bd-f5c56a938302",
  "email": "owner@tokomaju.id",
  "password": "current-password"
}
```

Auth V2 menambah endpoint di bawah prefix `/auth/v2`. Repository saat ini tidak
menggunakan global prefix `/api/v1`, sehingga path dalam dokumen ini ditulis
sesuai route runtime yang aktual.

Auth V2 tidak mencakup:

- perubahan RBAC modul bisnis;
- pendaftaran tenant baru;
- password reset melalui email;
- biometric login;
- offline PIN verification;
- perubahan pada `cashier_sessions`;
- penghapusan endpoint login legacy.

`cashier_sessions` tetap berarti shift kasir dan kas fisik. Session autentikasi
perangkat disimpan sebagai `device_sessions`; keduanya tidak saling menggantikan.
Logout juga tidak otomatis menutup shift kasir.

## 2. Terminologi

| Istilah | Arti |
|---|---|
| Store | Tenant KasirKita. Identifier publiknya adalah `store_code`. |
| Device session | Session autentikasi satu user pada satu instalasi aplikasi. |
| Access token | JWT berumur pendek untuk mengakses API bisnis. |
| Refresh token | Token acak berumur lebih panjang yang hanya digunakan untuk rotasi token. |
| Cashier shift | `cashier_sessions`, yaitu sesi operasional kas dan bukan session autentikasi. |

## 3. Flow login

```text
Android memasukkan/scan store_code
        ↓
POST /auth/v2/store/resolve
        ↓
Backend mengembalikan tenant dan user aktif
        ↓
Android memilih user dan mengirim tenant_id + user_id + PIN
        ↓
POST /auth/v2/pin/login
        ↓
Backend memverifikasi tenant, user, lockout, dan PIN
        ↓
Backend mengembalikan JWT access token dan opaque refresh token
        ↓
Android memakai access token untuk API bisnis
```

Ketentuan flow:

1. `store_code` adalah identifier toko, bukan secret.
2. Store resolution hanya berhasil untuk tenant aktif.
3. Daftar user hanya berisi user aktif yang berada pada tenant tersebut.
4. Response discovery tidak boleh memuat email, password hash, PIN hash,
   failed-attempt counter, atau data session.
5. PIN dikirim sebagai string agar nilai yang diawali angka nol tidak berubah.
6. `user_id` yang tidak berada pada `tenant_id` request diperlakukan sebagai
   credential salah. Backend tidak mengungkap tenant pemilik user tersebut.
7. Login memerlukan koneksi backend. Offline unlock berada di luar
   scope Auth V2.

## 4. Format umum

Request dan response menggunakan JSON, kecuali response `204 No Content`.

```http
Content-Type: application/json
```

Endpoint terproteksi menggunakan:

```http
Authorization: Bearer <access_token>
```

Successful response Auth V2 menggunakan object langsung tanpa global response
envelope, mengikuti perilaku controller backend saat ini.

Error bisnis Auth V2 menggunakan bentuk stabil:

```json
{
  "statusCode": 401,
  "error_code": "INVALID_CREDENTIALS",
  "message": "User or PIN is invalid"
}
```

Validation error dapat menambahkan `details`. `error_code` tidak boleh berasal
dari pesan internal Prisma, bcrypt, atau JWT library.

## 5. Endpoint contract

### 5.1 Resolve store dan discover users

```http
POST /auth/v2/store/resolve
```

**Authentication:** Public  
**Rate limit:** wajib per IP dan per `store_code`

Request:

```json
{
  "store_code": "TOKO-MAJU"
}
```

Validation:

- `store_code` wajib string;
- panjangnya 3–32 karakter dan harus sudah uppercase;
- karakter yang diizinkan: `A-Z`, `0-9`, dan `-`.

Response `200 OK`:

```json
{
  "tenant": {
    "id": "3ece59dc-9c6a-4fee-93bd-f5c56a938302",
    "name": "Toko Maju"
  },
  "users": [
    {
      "id": "8f1fbf18-ed1e-4db8-a78d-857238e08e62",
      "name": "Budi",
      "role": "CASHIER",
      "outlet_id": "ce591e13-afd5-46ee-b3a3-5a0fdc51c2ce"
    },
    {
      "id": "9cc53295-d489-47b6-9380-693c91a851db",
      "name": "Sari",
      "role": "OWNER",
      "outlet_id": null
    }
  ]
}
```

Jika kode tidak ditemukan atau tenant tidak aktif, response harus sama:

```http
404 Not Found
```

```json
{
  "statusCode": 404,
  "error_code": "STORE_NOT_FOUND",
  "message": "Store not found"
}
```

### 5.2 Login dengan PIN

```http
POST /auth/v2/pin/login
```

**Authentication:** Public credential endpoint  
**Roles:** `OWNER`, `ADMIN`, `CASHIER`

Request:

```json
{
  "tenant_id": "3ece59dc-9c6a-4fee-93bd-f5c56a938302",
  "user_id": "8f1fbf18-ed1e-4db8-a78d-857238e08e62",
  "pin": "042681",
  "device_id": "12877e15-6f15-4cf7-b728-c03d2aef8ff6",
  "device_name": "Kasir Samsung A15"
}
```

Validation:

- `tenant_id` wajib UUID;
- `user_id` wajib UUID;
- `pin` wajib string enam digit;
- `device_id` wajib UUID;
- `device_name` optional dengan panjang maksimum 100 karakter.

Response `200 OK`:

```json
{
  "access_token": "eyJhbGciOi...",
  "refresh_token": "Q7dG...opaque-random-token...",
  "expires_in": 86400
}
```

Sebelum membuat JWT, backend wajib memastikan:

- tenant aktif;
- user milik tenant tersebut dan aktif;
- user mempunyai PIN;
- user tidak sedang terkunci;
- PIN valid.

PIN login membuat `device_sessions` berstatus `ACTIVE`. Refresh token mentah
hanya dikembalikan sekali; database hanya menyimpan SHA-256 hash. `expires_in`
adalah umur access token dalam detik. Refresh session memakai TTL terpisah dari
`REFRESH_TOKEN_TTL_DAYS`, default 30 hari.

User yang tidak ditemukan, lintas tenant, inactive, belum dapat login, atau PIN
salah tidak boleh dibedakan melalui response:

```http
401 Unauthorized
```

```json
{
  "statusCode": 401,
  "error_code": "INVALID_CREDENTIALS",
  "message": "User or PIN is invalid"
}
```

Account yang mencapai batas percobaan:

```http
423 Locked
```

```json
{
  "statusCode": 423,
  "error_code": "PIN_LOCKED",
  "message": "PIN login is temporarily locked",
  "retry_after_seconds": 900
}
```

Threshold dibaca dari `PIN_MAX_FAILED_ATTEMPTS` dengan default 5. Durasi lock
dibaca dari `PIN_LOCK_DURATION_MINUTES` dengan default 15 menit. Schema saat ini
belum memiliki timestamp khusus kegagalan terakhir, sehingga implementasi fase
ini hanya memperbarui counter, `locked_until`, dan Prisma `updated_at`.

### 5.3 Refresh token

```http
POST /auth/v2/refresh
```

**Authentication:** Refresh token  
**Roles:** pemilik session

Request:

```json
{
  "refresh_token": "Q7dG...opaque-random-token..."
}
```

Response `200 OK` mengembalikan pasangan token baru:

```json
{
  "access_token": "eyJhbGciOi...new-access-token...",
  "refresh_token": "UT3x...new-opaque-refresh-token...",
  "expires_in": 86400
}
```

Setiap refresh merotasi refresh token secara atomik. Session lama ditandai
`REVOKED` dan session baru mendapat expiry baru berdasarkan
`REFRESH_TOKEN_TTL_DAYS`. Token lama tidak dapat digunakan lagi.

Jika refresh token lama digunakan kembali, backend merevoke session terkait dan
mengembalikan:

```json
{
  "statusCode": 401,
  "error_code": "INVALID_REFRESH_TOKEN",
  "message": "Refresh token is invalid or expired"
}
```

Refresh juga gagal jika user atau tenant inactive, session expired, atau session
sudah direvoke. Semua kondisi tersebut memakai `401 INVALID_REFRESH_TOKEN` agar
detail internal tidak bocor.

### 5.4 Logout current device

```http
POST /auth/v2/logout
```

**Authentication:** Refresh token possession

Request:

```json
{
  "refresh_token": "UT3x...opaque-refresh-token..."
}
```

Response:

```http
204 No Content
```

Logout bersifat idempotent. Token yang sudah invalid atau sudah direvoke tetap
menghasilkan `204`. Android menghapus access dan refresh token lokal setelah
response atau setelah memutuskan melakukan local logout.

### 5.5 Logout all devices

**Status:** Belum diimplementasikan.

```http
POST /auth/v2/logout-all
Authorization: Bearer <access_token>
```

**Roles:** `OWNER`, `ADMIN`, `CASHIER` untuk session sendiri

Response:

```http
204 No Content
```

Semua device session milik user pada tenant tersebut, termasuk session pemanggil,
direvoke. Endpoint ini tidak menutup cashier shift.

### 5.6 Current authenticated context

```http
GET /auth/v2/me
Authorization: Bearer <access_token>
```

**Roles:** `OWNER`, `ADMIN`, `CASHIER`

Response `200 OK`:

```json
{
  "user": {
    "id": "8f1fbf18-ed1e-4db8-a78d-857238e08e62",
    "name": "Budi",
    "role": "CASHIER",
    "outlet_id": "ce591e13-afd5-46ee-b3a3-5a0fdc51c2ce"
  },
  "tenant": {
    "id": "3ece59dc-9c6a-4fee-93bd-f5c56a938302",
    "name": "Toko Maju"
  },
  "session": {
    "id": "db143aa0-d4c5-42cb-8188-a92f00f6422f",
    "device_id": "12877e15-6f15-4cf7-b728-c03d2aef8ff6",
    "device_name": "Kasir Samsung A15",
    "expires_at": "2026-10-26T08:00:00.000Z"
  }
}
```

Response tidak memuat `pin_hash`, `password_hash`, refresh token hash, atau
failed-attempt counter.

### 5.7 Initial PIN enrollment

```http
POST /auth/v2/pin/enroll
Authorization: Bearer <legacy-or-v2-access-token>
```

**Roles:** `OWNER`, `ADMIN`, `CASHIER` untuk diri sendiri  
**Purpose:** transisi user legacy yang belum mempunyai PIN

Request:

```json
{
  "current_password": "current-password",
  "pin": "042681",
  "pin_confirmation": "042681"
}
```

Response:

```http
204 No Content
```

Backend wajib memverifikasi password existing. Endpoint hanya dapat dipakai
ketika user belum mempunyai PIN. Jika PIN sudah ada:

```json
{
  "statusCode": 409,
  "error_code": "PIN_ALREADY_CONFIGURED",
  "message": "PIN is already configured"
}
```

User tanpa password tidak dapat menggunakan enrollment ini dan harus meminta
OWNER atau ADMIN melakukan provisioning/reset.

### 5.8 Change own PIN

```http
PATCH /auth/v2/pin
Authorization: Bearer <access_token>
```

**Roles:** `OWNER`, `ADMIN`, `CASHIER` untuk diri sendiri

Request:

```json
{
  "current_pin": "042681",
  "new_pin": "713905",
  "new_pin_confirmation": "713905"
}
```

Response:

```http
204 No Content
```

Setelah PIN berubah, seluruh device session user direvoke. Android harus
menghapus token lokal dan meminta login ulang.

### 5.9 Provision or reset another user's PIN

```http
POST /users/:id/pin
Authorization: Bearer <access_token>
```

**Roles:** `OWNER`, `ADMIN`  
**Tenant rule:** target wajib berada pada tenant actor

Request:

```json
{
  "pin": "713905"
}
```

Response:

```http
204 No Content
```

Operasi ini:

- membuat PIN pertama atau mengganti PIN target;
- mengatur `pin_changed_at`;
- mengosongkan failed-attempt counter dan `locked_until`;
- mengembalikan `404 USER_NOT_FOUND` untuk user nonexistent, inactive, atau
  lintas tenant.

Session revocation dan auth audit event akan ditambahkan bersama implementasi
PIN login/device session. Endpoint ini tidak mengembalikan PIN atau hash.

Endpoint ini hanya mengatur credential PIN. Permission pembuatan user existing
tetap hanya diberikan kepada `OWNER`.

## 6. JWT access-token contract

Access token Auth V2 minimal membawa:

```json
{
  "sub": "8f1fbf18-ed1e-4db8-a78d-857238e08e62",
  "tenant_id": "3ece59dc-9c6a-4fee-93bd-f5c56a938302",
  "role": "CASHIER",
  "outlet_id": "ce591e13-afd5-46ee-b3a3-5a0fdc51c2ce",
  "iat": 1790409600,
  "exp": 1790496000
}
```

Rules:

- `sub` adalah `users.id`;
- `tenant_id` selalu berasal dari record user, bukan request client;
- `outlet_id` nullable untuk user tenant-wide;
- access token PIN login menggunakan signing configuration existing dan saat ini
  berlaku 1 hari;
- authorization query tetap menggunakan tenant dari authenticated context.

PIN login dan refresh sengaja memakai payload yang sama dengan login
email/password. Device session mengotorisasi refresh token, tetapi `sid` belum
ditambahkan ke access token dan access token tidak direvoke. Penghapusan
dukungan JWT legacy merupakan pekerjaan terpisah setelah Android selesai
migrasi.

## 7. PIN policy

PIN Auth V2 wajib memenuhi aturan berikut:

- tepat enam digit (`000000` sampai `999999`);
- diperlakukan sebagai string;
- PIN hanya dikirim melalui HTTPS;
- database hanya menyimpan hash dengan salt, tidak menyimpan PIN plaintext atau
  encrypted reversible value;
- PIN, hash, dan request body credential tidak boleh masuk application log,
  audit metadata, analytics, atau crash report.

Hash enrollment menggunakan bcrypt. Cost saat ini mengikuti konfigurasi backend
yang juga digunakan untuk password hashing. Algoritma dan parameter hash harus
dapat ditingkatkan tanpa mengubah API contract.

Lockout policy:

- lima kegagalan PIN berturut-turut mengunci user selama 15 menit;
- counter di-update secara atomik;
- login berhasil mereset counter dan lockout;
- lockout berlaku per user dalam tenant, bukan hanya per perangkat;
- reset PIN oleh OWNER atau ADMIN menghapus lockout;
- rate limit per IP, store, user, dan device tetap wajib agar attacker tidak
  dapat berpindah target untuk menghindari lockout.

## 8. Session behavior

### 8.1 Creation dan device identity

- PIN login membuat satu `device_session`.
- `device_id` dibuat Android sekali per instalasi dan disimpan stabil.
- `device_id` adalah identifier, bukan secret atau authentication factor.
- User boleh mempunyai session pada beberapa perangkat.
- Batas maksimum perangkat tidak ditetapkan untuk MVP dan dapat ditambahkan
  sebagai policy tanpa mengubah request contract.

### 8.2 Lifetime

- access token: 1 hari mengikuti konfigurasi JWT existing;
- device session dan refresh token: default 30 hari;
- refresh membuat session baru dengan expiry baru berdasarkan konfigurasi TTL.

### 8.3 Refresh rotation

- refresh token adalah nilai acak opaque dengan entropy tinggi;
- database hanya menyimpan hash refresh token;
- refresh dilakukan dalam transaksi database;
- token lama ditandai `REVOKED` ketika token baru diterbitkan;
- token lama yang digunakan kembali ditolak;
- hanya satu refresh concurrent yang boleh berhasil.

### 8.4 Revocation

Session wajib direvoke ketika:

- user logout dari device;
- refresh token berhasil dirotasi;
- session expired, user inactive, atau tenant inactive terdeteksi saat refresh.

Revocation session tidak menghapus transaksi, stock movement, shift, atau audit
historis. Logout dan expiry session tidak menutup shift kasir.

## 9. Role permissions

### 9.1 Auth V2 endpoints

| Endpoint | Public | OWNER | ADMIN | CASHIER |
|---|:---:|:---:|:---:|:---:|
| `POST /auth/v2/store/resolve` | Ya | Ya | Ya | Ya |
| `POST /auth/v2/pin/login` | Credential publik | Ya | Ya | Ya |
| `POST /auth/v2/refresh` | Refresh token | Own session | Own session | Own session |
| `POST /auth/v2/logout` | Refresh token | Own session | Own session | Own session |
| `POST /auth/v2/logout-all` | Tidak | Own sessions | Own sessions | Own sessions |
| `GET /auth/v2/me` | Tidak | Ya | Ya | Ya |
| `POST /auth/v2/pin/enroll` | Tidak | Self | Self | Self |
| `PATCH /auth/v2/pin` | Tidak | Self | Self | Self |
| `POST /users/:id/pin` | Tidak | Same-tenant active user | Same-tenant active user | Tidak |

### 9.2 Existing business permissions

Auth V2 tidak mengubah policy RBAC yang sudah berjalan:

- user dan outlet creation tetap `OWNER`;
- product/category mutation dan stock adjustment tetap `OWNER` atau `ADMIN`;
- reports tetap `OWNER` atau `ADMIN`;
- transaction creation, receipt, shift, dan offline sync tetap tersedia untuk
  `OWNER`, `ADMIN`, dan `CASHIER` sesuai tenant/outlet rule existing;
- customer mutation tetap `OWNER` atau `ADMIN`, sementara read tetap tersedia
  bagi role yang sudah diizinkan;
- `CASHIER` tidak memperoleh permission administrasi baru melalui Auth V2.

Role di JWT membantu routing dan UI, tetapi backend tetap menjadi sumber
otoritas. Client tidak boleh menentukan role atau tenant dalam login response.

## 10. Tenant dan outlet isolation

- Store resolution memperoleh tenant dari `store_code` yang unik.
- PIN login memvalidasi pasangan `user_id + tenant_id` secara langsung.
- User lookup selalu menggunakan pasangan `user_id + tenant_id`.
- Device session menyimpan `tenant_id` dan `user_id` dengan tenant-aware foreign
  key.
- Target PIN reset selalu difilter menggunakan tenant actor.
- Resource lintas tenant tidak pernah dikonfirmasi keberadaannya.
- `CASHIER` hanya mendapat `outlet_id` yang ditetapkan backend.
- `OWNER` dan `ADMIN` dengan `outlet_id=null` tetap mengikuti authorization
  tenant-wide existing.
- Auth V2 tidak menambahkan `tenant_id` yang dapat dipercaya dari request API
  bisnis. Tenant API bisnis tetap berasal dari JWT tervalidasi.

## 11. Stable errors

| HTTP | `error_code` | Penggunaan |
|---:|---|---|
| 400 | `INVALID_INPUT` | Format request atau UUID invalid. |
| 400 | `PIN_POLICY_VIOLATION` | PIN tidak memenuhi policy. |
| 401 | `INVALID_CREDENTIALS` | User/PIN invalid atau user tidak dapat login. |
| 401 | `CURRENT_PIN_INVALID` | PIN saat ini salah ketika mengganti PIN. |
| 401 | `INVALID_REFRESH_TOKEN` | Refresh token/session tidak valid atau expired. |
| 403 | `FORBIDDEN` | Role tidak memiliki permission. |
| 404 | `STORE_NOT_FOUND` | Store tidak ada atau tenant inactive. |
| 404 | `USER_NOT_FOUND` | Target administrasi tidak ada atau lintas tenant. |
| 409 | `PIN_ALREADY_CONFIGURED` | Enrollment dipanggil setelah PIN tersedia. |
| 423 | `PIN_LOCKED` | Batas kegagalan PIN tercapai. |
| 429 | `RATE_LIMITED` | Rate limit request tercapai. |

Backend tidak boleh mengembalikan Prisma error, JWT library error, hash error,
stack trace, nilai credential, atau informasi apakah user berada pada tenant
lain.

## 12. Audit events

Auth V2 mencatat minimal event berikut:

- `AUTH_STORE_RESOLVE_FAILED` tanpa credential sensitif;
- `AUTH_PIN_LOGIN_SUCCEEDED`;
- `AUTH_PIN_LOGIN_FAILED`;
- `AUTH_PIN_LOCKED`;
- `AUTH_PIN_ENROLLED`;
- `AUTH_PIN_CHANGED`;
- `AUTH_PIN_RESET_BY_ADMINISTRATOR`;
- `AUTH_SESSION_REFRESHED`;
- `AUTH_SESSION_REVOKED`;
- `AUTH_REFRESH_REUSE_DETECTED`.

Audit metadata boleh memuat tenant, actor/target user, session, device ID, IP,
user agent, result, dan timestamp. Metadata tidak boleh memuat PIN, password,
access token, refresh token, atau credential hash.

## 13. Required schema capabilities

Migration berikutnya harus mendukung kontrak ini secara additive, minimal:

- tenant `store_code` yang unik dan stabil;
- user `pin_hash`, failed-attempt counter, `locked_until`, dan timestamp terkait;
- `device_sessions` dengan tenant-aware user relation, token hash, expiry,
  rotation, dan revocation state;
- auth `audit_logs`;
- email dan password existing tetap dipertahankan selama legacy login hidup.

Kolom baru yang belum mempunyai data backfill harus nullable atau memiliki
default yang aman pada migration awal. Migration tidak boleh mengubah ID user,
memutus relasi historis, mereset database, atau menggunakan `cashier_sessions`
sebagai device session.

## 14. Rollout gates

Fase berikut hanya boleh dimulai setelah fase sebelumnya diverifikasi:

1. Dokumen contract disetujui.
2. Additive schema migration dan data preflight selesai.
3. Backend Auth V2 endpoint, lockout, rotation, revocation, dan audit selesai.
4. Integration/security tests Auth V2 lulus.
5. Android menambah store discovery, user selection, PIN login, dan refresh.
6. Monitoring menunjukkan user telah berhasil enroll/menerima PIN.
7. Legacy login diberi jadwal deprecation terpisah.
8. Email/password nullability atau penghapusan credential lama baru dibahas
   setelah seluruh client selesai migrasi dan rollback window berakhir.
