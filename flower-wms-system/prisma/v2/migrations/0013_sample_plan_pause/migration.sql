-- Sprint 4 closure / sample plan pause.
--
-- Pausing keeps the plan and its execution history. Unissued reservations are
-- released by the service in the same transaction, while material already in
-- the production area stays there for a verified resume or cancellation.
--
-- PostgreSQL cannot add and use a new enum value in the same transaction, so
-- this migration only adds the value. The service starts using PAUSED after
-- the migration commits.

ALTER TYPE "SamplePlanState" ADD VALUE IF NOT EXISTS 'PAUSED';
