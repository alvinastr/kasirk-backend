export enum TransactionStatus {
    PENDING = 'PENDING',
    COMPLETED = 'COMPLETED',
    CANCELLED = 'CANCELLED',
    VOID = 'VOID',
}

export enum PaymentStatus {
    PENDING = 'PENDING',
    PAID = 'PAID',
    FAILED = 'FAILED',
    CANCELLED = 'CANCELLED',
}

export enum PaymentMethod {
    CASH = 'CASH',
    QRIS = 'QRIS',
}
