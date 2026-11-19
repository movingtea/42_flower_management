-- Sprint 4 / sampling optimisation and sample-to-product.
--
-- Sample designs keep a target gross margin for the cost / target price
-- calculator. Execution rows distinguish approval from the actual start so
-- approval can reserve only the first step while the stock transfer happens
-- when the florist starts making the sample.
--
-- All columns are additive or relax an existing default; no business data is
-- deleted. Actual quantities and costs are persisted per execution step so the
-- sample reuse / cost variance report does not have to infer them from JSON.

ALTER TABLE "Sample"
  ADD COLUMN "targetMarginRate" DECIMAL(7,4);

ALTER TABLE "SamplePlanExecution"
  ADD COLUMN "approvedAt" TIMESTAMP(3),
  ADD COLUMN "cancelledAt" TIMESTAMP(3),
  ADD COLUMN "actualCost" DECIMAL(14,2),
  ADD COLUMN "costEstimated" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "SamplePlanExecution"
  ALTER COLUMN "startedAt" DROP DEFAULT,
  ALTER COLUMN "startedAt" DROP NOT NULL;

ALTER TABLE "SamplePlanExecutionStep"
  ADD COLUMN "startedAt" TIMESTAMP(3),
  ADD COLUMN "usedQty" DECIMAL(14,3) NOT NULL DEFAULT 0,
  ADD COLUMN "reusedQty" DECIMAL(14,3) NOT NULL DEFAULT 0,
  ADD COLUMN "lostQty" DECIMAL(14,3) NOT NULL DEFAULT 0,
  ADD COLUMN "returnedQty" DECIMAL(14,3) NOT NULL DEFAULT 0,
  ADD COLUMN "reusableQty" DECIMAL(14,3) NOT NULL DEFAULT 0,
  ADD COLUMN "actualCost" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN "costEstimated" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "SampleInventoryReservation"
  ADD COLUMN "executionStepId" TEXT;

CREATE INDEX "SampleInventoryReservation_executionStepId_state_idx"
  ON "SampleInventoryReservation"("executionStepId", "state");

ALTER TABLE "SampleInventoryReservation"
  ADD CONSTRAINT "SampleInventoryReservation_executionStepId_fkey"
  FOREIGN KEY ("executionStepId") REFERENCES "SamplePlanExecutionStep"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
