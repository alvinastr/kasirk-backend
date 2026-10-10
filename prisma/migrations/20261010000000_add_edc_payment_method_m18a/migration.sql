BEGIN;

ALTER TABLE "payments"
    DROP CONSTRAINT "chk_payments_method";

ALTER TABLE "payments"
    ADD CONSTRAINT "chk_payments_method"
    CHECK (((method)::text = ANY ((ARRAY['CASH'::character varying, 'QRIS'::character varying, 'EDC'::character varying])::text[])));

COMMIT;
