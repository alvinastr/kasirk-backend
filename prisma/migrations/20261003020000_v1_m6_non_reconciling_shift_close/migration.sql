-- V1-M6: Allow CLOSED V1 shifts without legacy cash reconciliation values.
-- Historical reconciling CLOSED shifts remain valid; partial reconciliation fields remain invalid.

ALTER TABLE "cashier_sessions"
DROP CONSTRAINT "chk_cashier_sessions_state";

ALTER TABLE "cashier_sessions"
ADD CONSTRAINT "chk_cashier_sessions_state" CHECK (
    (
        "status" = 'OPEN'
        AND "closing_cash" IS NULL
        AND "expected_cash" IS NULL
        AND "difference" IS NULL
        AND "closed_at" IS NULL
    )
    OR
    (
        "status" = 'CLOSED'
        AND "closed_at" IS NOT NULL
        AND (
            (
                "closing_cash" IS NULL
                AND "expected_cash" IS NULL
                AND "difference" IS NULL
            )
            OR
            (
                "closing_cash" IS NOT NULL
                AND "expected_cash" IS NOT NULL
                AND "difference" IS NOT NULL
            )
        )
    )
);
