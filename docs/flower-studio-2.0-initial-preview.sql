-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "MaterialKind" AS ENUM ('FLOWER', 'FOLIAGE', 'PACKAGING', 'CONSUMABLE', 'OTHER');

-- CreateEnum
CREATE TYPE "LocationKind" AS ENUM ('WAREHOUSE', 'PRODUCTION');

-- CreateEnum
CREATE TYPE "RecipeState" AS ENUM ('DRAFT', 'PUBLISHED', 'RETIRED');

-- CreateEnum
CREATE TYPE "CommercialState" AS ENUM ('DRAFT', 'PENDING_CONFIRMATION', 'PENDING_PAYMENT', 'CONFIRMED', 'CANCELLED', 'CLOSED');

-- CreateEnum
CREATE TYPE "SupplyState" AS ENUM ('NOT_EVALUATED', 'ON_HAND_COVERED', 'INBOUND_COVERED', 'PURCHASE_REQUIRED', 'SUBSTITUTION_REQUIRED', 'PARTIALLY_COVERED', 'UNFULFILLABLE');

-- CreateEnum
CREATE TYPE "ProductionState" AS ENUM ('NOT_SCHEDULED', 'WAITING_MATERIAL', 'READY', 'IN_PROGRESS', 'COMPLETED', 'EXCEPTION');

-- CreateEnum
CREATE TYPE "FulfillmentState" AS ENUM ('UNPLANNED', 'WAITING_PICKUP', 'WAITING_DELIVERY', 'DELIVERING', 'DELIVERED', 'FAILED');

-- CreateEnum
CREATE TYPE "OrderEntry" AS ENUM ('MINI_PROGRAM', 'STAFF_PORTAL', 'API', 'IMPORT');

-- CreateEnum
CREATE TYPE "OrderItemKind" AS ENUM ('STANDARD', 'CUSTOM');

-- CreateEnum
CREATE TYPE "HoldState" AS ENUM ('ACTIVE', 'RELEASED', 'EXPIRED', 'CONVERTED');

-- CreateEnum
CREATE TYPE "ReservationState" AS ENUM ('ACTIVE', 'ISSUED', 'CONSUMED', 'RELEASED');

-- CreateEnum
CREATE TYPE "PurchaseState" AS ENUM ('DRAFT', 'ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED', 'CLOSED');

-- CreateEnum
CREATE TYPE "ReceiptDisposition" AS ENUM ('ACCEPTED', 'DOWNGRADED', 'REJECTED');

-- CreateEnum
CREATE TYPE "TransactionKind" AS ENUM ('INBOUND', 'TRANSFER', 'CONSUME', 'LOSS', 'RETURN', 'ADJUSTMENT', 'FREEZE', 'UNFREEZE');

-- CreateEnum
CREATE TYPE "CostKind" AS ENUM ('MATERIAL', 'PACKAGING', 'CONSUMABLE', 'LABOR', 'DELIVERY', 'PLATFORM', 'LOSS');

-- CreateEnum
CREATE TYPE "CostStage" AS ENUM ('STANDARD', 'PLANNED', 'ACTUAL');

-- CreateEnum
CREATE TYPE "PaymentKind" AS ENUM ('MINI_PROGRAM', 'WECHAT_TRANSFER', 'CASH', 'BANK_TRANSFER', 'CARD', 'OTHER');

-- CreateEnum
CREATE TYPE "PaymentState" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'VOIDED');

-- CreateEnum
CREATE TYPE "RefundState" AS ENUM ('REQUESTED', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "FulfillmentKind" AS ENUM ('DELIVERY', 'PICKUP');

-- CreateEnum
CREATE TYPE "DeliveryAttemptState" AS ENUM ('SCHEDULED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'FAILED');

-- CreateEnum
CREATE TYPE "SampleState" AS ENUM ('DRAFT', 'READY', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "SamplePlanState" AS ENUM ('DRAFT', 'PROPOSED', 'APPROVED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SamplePlanCandidateState" AS ENUM ('REQUIRED', 'OPTIONAL', 'EXCLUDED');

-- CreateEnum
CREATE TYPE "ConsumableRollState" AS ENUM ('SEALED', 'IN_USE', 'EXHAUSTED');

-- CreateEnum
CREATE TYPE "StocktakeState" AS ENUM ('DRAFT', 'CONFIRMED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LossReason" AS ENUM ('RECEIPT_REJECTED', 'CARE_DAMAGE', 'EXPIRED', 'PRODUCTION_ERROR', 'DELIVERY_DAMAGE', 'STOCKTAKE_DIFFERENCE', 'OTHER');

-- CreateEnum
CREATE TYPE "ContentTargetKind" AS ENUM ('NONE', 'PRODUCT', 'PRODUCT_FILTER', 'RECOMMENDATION_SLOT', 'CUSTOM_URL');

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Store" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Store_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryLocation" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "kind" "LocationKind" NOT NULL,

    CONSTRAINT "InventoryLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Material" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "MaterialKind" NOT NULL,
    "color" TEXT,
    "grade" TEXT,
    "gradeSpecification" TEXT,
    "specification" TEXT,
    "baseUnit" TEXT NOT NULL,
    "quantityScale" INTEGER NOT NULL DEFAULT 0,
    "reservePerOrder" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Material_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "defaultSkuId" TEXT,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductSku" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "sourceSampleId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price" DECIMAL(14,2) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "preorderAllowed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ProductSku_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recipe" (
    "id" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,

    CONSTRAINT "Recipe_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecipeVersion" (
    "id" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "state" "RecipeState" NOT NULL DEFAULT 'DRAFT',
    "effectiveAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),

    CONSTRAINT "RecipeVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecipeLine" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "plannedQty" DECIMAL(14,3) NOT NULL,
    "toleranceQty" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "expectedLossRate" DECIMAL(7,4) NOT NULL DEFAULT 0,

    CONSTRAINT "RecipeLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "createdVia" "OrderEntry" NOT NULL,
    "sourceChannel" TEXT NOT NULL,
    "commercialState" "CommercialState" NOT NULL DEFAULT 'DRAFT',
    "supplyState" "SupplyState" NOT NULL DEFAULT 'NOT_EVALUATED',
    "productionState" "ProductionState" NOT NULL DEFAULT 'NOT_SCHEDULED',
    "fulfillmentState" "FulfillmentState" NOT NULL DEFAULT 'UNPLANNED',
    "deliveryAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "customerId" TEXT,
    "recipientId" TEXT,
    "buyerNameSnapshot" TEXT,
    "buyerPhoneSnapshot" TEXT,
    "recipientNameSnapshot" TEXT,
    "recipientPhoneSnapshot" TEXT,
    "addressSnapshot" TEXT,
    "greetingCardSnapshot" TEXT,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "kind" "OrderItemKind" NOT NULL,
    "skuId" TEXT,
    "recipeVersionId" TEXT,
    "nameSnapshot" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderRevision" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderMaterialRequirement" (
    "id" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "plannedQty" DECIMAL(14,3) NOT NULL,
    "needBy" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderMaterialRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AvailabilityHold" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "state" "HoldState" NOT NULL DEFAULT 'ACTIVE',

    CONSTRAINT "AvailabilityHold_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AvailabilityHoldMaterial" (
    "id" TEXT NOT NULL,
    "holdId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,

    CONSTRAINT "AvailabilityHoldMaterial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "state" "PurchaseState" NOT NULL DEFAULT 'DRAFT',
    "expectedAt" TIMESTAMP(3),

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrderLine" (
    "id" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "orderedQty" DECIMAL(14,3) NOT NULL,
    "purchaseUnit" TEXT NOT NULL,
    "expectedBaseQty" DECIMAL(14,3),
    "unitPrice" DECIMAL(14,4) NOT NULL,
    "supplierConfirmedAt" TIMESTAMP(3),

    CONSTRAINT "PurchaseOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FutureSupplyAllocation" (
    "id" TEXT NOT NULL,
    "purchaseLineId" TEXT NOT NULL,
    "requirementId" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "expectedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FutureSupplyAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseDemandAllocation" (
    "id" TEXT NOT NULL,
    "purchaseLineId" TEXT NOT NULL,
    "requirementId" TEXT NOT NULL,
    "allocatedQty" DECIMAL(14,3) NOT NULL,

    CONSTRAINT "PurchaseDemandAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoodsReceipt" (
    "id" TEXT NOT NULL,
    "purchaseOrderId" TEXT,
    "storeId" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "emergencyReason" TEXT,

    CONSTRAINT "GoodsReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoodsReceiptLine" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "purchaseLineId" TEXT,
    "acceptedMaterialId" TEXT,
    "disposition" "ReceiptDisposition" NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "baseUnit" TEXT NOT NULL,
    "gradeChangeReason" TEXT,
    "rejectionReason" TEXT,
    "finalUnitCost" DECIMAL(14,4),

    CONSTRAINT "GoodsReceiptLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryBatch" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "receiptLineId" TEXT,
    "batchNo" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usableUntil" TIMESTAMP(3),
    "unitCost" DECIMAL(14,4) NOT NULL,
    "costEstimated" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "InventoryBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BatchBalance" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "onHandQty" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "frozenQty" DECIMAL(14,3) NOT NULL DEFAULT 0,

    CONSTRAINT "BatchBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsumableRoll" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "state" "ConsumableRollState" NOT NULL DEFAULT 'SEALED',
    "openedAt" TIMESTAMP(3),
    "exhaustedAt" TIMESTAMP(3),

    CONSTRAINT "ConsumableRoll_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryReservation" (
    "id" TEXT NOT NULL,
    "requirementId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "state" "ReservationState" NOT NULL DEFAULT 'ACTIVE',

    CONSTRAINT "InventoryReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryTransaction" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "kind" "TransactionKind" NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "fromLocationId" TEXT,
    "toLocationId" TEXT,
    "referenceType" TEXT NOT NULL,
    "referenceId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionTask" (
    "id" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "state" "ProductionState" NOT NULL DEFAULT 'NOT_SCHEDULED',
    "assigneeId" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ProductionTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaterialUsage" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "usedQty" DECIMAL(14,3) NOT NULL,
    "lostQty" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "returnedQty" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "differenceReason" TEXT,

    CONSTRAINT "MaterialUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sample" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "state" "SampleState" NOT NULL DEFAULT 'DRAFT',
    "imageKey" TEXT,
    "description" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Sample_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SampleMaterial" (
    "id" TEXT NOT NULL,
    "sampleId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,

    CONSTRAINT "SampleMaterial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SamplePlan" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "state" "SamplePlanState" NOT NULL DEFAULT 'DRAFT',
    "inventoryEvaluatedAt" TIMESTAMP(3),
    "estimatedPurchaseCost" DECIMAL(14,2),
    "estimatedSaving" DECIMAL(14,2),
    "approvedAt" TIMESTAMP(3),
    "selectedRunId" TEXT,

    CONSTRAINT "SamplePlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SamplePlanItem" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "sampleId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "mandatory" BOOLEAN NOT NULL DEFAULT false,
    "candidateState" "SamplePlanCandidateState" NOT NULL DEFAULT 'OPTIONAL',
    "sequenceNo" INTEGER,

    CONSTRAINT "SamplePlanItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SamplePlanMaterial" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "requiredQty" DECIMAL(14,3) NOT NULL,
    "fromStockQty" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "reusedQty" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "purchaseQty" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "expectedLossQty" DECIMAL(14,3) NOT NULL DEFAULT 0,

    CONSTRAINT "SamplePlanMaterial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SamplePlanRun" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "runNo" INTEGER NOT NULL,
    "calculationGroupId" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "algorithmVersion" TEXT NOT NULL,
    "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requestedSampleCount" INTEGER NOT NULL,
    "lossPolicySnapshot" JSONB NOT NULL,
    "candidateSnapshot" JSONB NOT NULL,
    "inventoryBaselineAt" TIMESTAMP(3) NOT NULL,
    "independentCost" DECIMAL(14,2) NOT NULL,
    "totalCost" DECIMAL(14,2) NOT NULL,
    "estimatedSaving" DECIMAL(14,2) NOT NULL,
    "reuseRate" DECIMAL(7,4) NOT NULL,

    CONSTRAINT "SamplePlanRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SamplePlanInventorySnapshot" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "availableQty" DECIMAL(14,3) NOT NULL,
    "unitCost" DECIMAL(14,4) NOT NULL,
    "unitSnapshot" TEXT NOT NULL,

    CONSTRAINT "SamplePlanInventorySnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SamplePlanStep" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "sequenceNo" INTEGER NOT NULL,
    "sampleId" TEXT NOT NULL,
    "sampleNameSnapshot" TEXT NOT NULL,
    "plannedQuantity" INTEGER NOT NULL,
    "incrementalCost" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "SamplePlanStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SamplePlanStepMaterial" (
    "id" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "materialNameSnapshot" TEXT NOT NULL,
    "gradeSnapshot" TEXT,
    "unitSnapshot" TEXT NOT NULL,
    "requiredQty" DECIMAL(14,3) NOT NULL,
    "stockQty" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "reusedQty" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "purchaseQty" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "reusableAfterDisassemblyQty" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "lossQty" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "poolRemainingQty" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "incrementalCost" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "SamplePlanStepMaterial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SamplePlanExecution" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "selectedRunId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "SamplePlanExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SamplePlanExecutionStep" (
    "id" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "plannedStepId" TEXT NOT NULL,
    "actualReusableSnapshot" JSONB,
    "recalculatedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "SamplePlanExecutionStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SampleDisassemblyMaterial" (
    "id" TEXT NOT NULL,
    "executionStepId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "sourceBatchId" TEXT,
    "usableQty" DECIMAL(14,3) NOT NULL,
    "rejectedQty" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "usableUntil" TIMESTAMP(3),
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checkedById" TEXT,

    CONSTRAINT "SampleDisassemblyMaterial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SampleInventoryReservation" (
    "id" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "state" "ReservationState" NOT NULL DEFAULT 'ACTIVE',

    CONSTRAINT "SampleInventoryReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentTransaction" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "method" "PaymentKind" NOT NULL,
    "state" "PaymentState" NOT NULL DEFAULT 'PENDING',
    "amount" DECIMAL(14,2) NOT NULL,
    "externalReference" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "confirmedById" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefundTransaction" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "state" "RefundState" NOT NULL DEFAULT 'REQUESTED',
    "amount" DECIMAL(14,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "externalReference" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefundTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Fulfillment" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "kind" "FulfillmentKind" NOT NULL,
    "scheduledAt" TIMESTAMP(3),
    "recipientName" TEXT,
    "recipientPhone" TEXT,
    "addressSnapshot" TEXT,
    "pickupCode" TEXT,
    "handedOverAt" TIMESTAMP(3),
    "handedOverById" TEXT,
    "deliveryFeeCharged" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "deliveryCostEstimated" DECIMAL(14,2),
    "deliveryCostActual" DECIMAL(14,2),

    CONSTRAINT "Fulfillment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryAttempt" (
    "id" TEXT NOT NULL,
    "fulfillmentId" TEXT NOT NULL,
    "attemptNo" INTEGER NOT NULL,
    "state" "DeliveryAttemptState" NOT NULL DEFAULT 'SCHEDULED',
    "departedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "proofKey" TEXT,
    "deliveryCost" DECIMAL(14,2),

    CONSTRAINT "DeliveryAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CostEntry" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "kind" "CostKind" NOT NULL,
    "stage" "CostStage" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "estimated" BOOLEAN NOT NULL DEFAULT false,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CostEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderCostSnapshot" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "revisionNo" INTEGER NOT NULL,
    "revenue" DECIMAL(14,2) NOT NULL,
    "materialCost" DECIMAL(14,2) NOT NULL,
    "packagingCost" DECIMAL(14,2) NOT NULL,
    "consumableCost" DECIMAL(14,2) NOT NULL,
    "laborCost" DECIMAL(14,2) NOT NULL,
    "deliveryCost" DECIMAL(14,2) NOT NULL,
    "platformCost" DECIMAL(14,2) NOT NULL,
    "attributedLossCost" DECIMAL(14,2) NOT NULL,
    "estimated" BOOLEAN NOT NULL DEFAULT false,
    "closedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderCostSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CostAdjustment" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "kind" "CostKind" NOT NULL,
    "amountDelta" DECIMAL(14,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CostAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffUser" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "StaffUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantMember" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "staffUserId" TEXT NOT NULL,
    "roles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "TenantMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreMember" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "staffUserId" TEXT NOT NULL,
    "roles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "StoreMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MiniProgramIdentity" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "openId" TEXT NOT NULL,
    "unionId" TEXT,
    "customerId" TEXT,

    CONSTRAINT "MiniProgramIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT,
    "phone" TEXT,
    "sourceChannel" TEXT,
    "note" TEXT,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recipient" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "address" TEXT,
    "preferenceNote" TEXT,

    CONSTRAINT "Recipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerRecipientRelation" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "relationLabel" TEXT,
    "defaultRecipient" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "CustomerRecipientRelation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GiftOccasion" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "recipientId" TEXT,
    "kind" TEXT NOT NULL,
    "importantDate" TIMESTAMP(3),

    CONSTRAINT "GiftOccasion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerReminder" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "remindAt" TIMESTAMP(3) NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',

    CONSTRAINT "CustomerReminder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Stocktake" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "state" "StocktakeState" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),

    CONSTRAINT "Stocktake_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StocktakeLine" (
    "id" TEXT NOT NULL,
    "stocktakeId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "countedQty" DECIMAL(14,3) NOT NULL,
    "recordedQty" DECIMAL(14,3) NOT NULL,
    "reason" TEXT,

    CONSTRAINT "StocktakeLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LossRecord" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "batchId" TEXT,
    "orderId" TEXT,
    "reason" "LossReason" NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "note" TEXT,
    "pendingBatchVerification" BOOLEAN NOT NULL DEFAULT false,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LossRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreSettings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "deliveryConfig" JSONB NOT NULL,
    "capacityConfig" JSONB NOT NULL,
    "lossReviewThreshold" DECIMAL(14,2) NOT NULL DEFAULT 0,

    CONSTRAINT "StoreSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "storeId" TEXT,
    "actorStaffId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "beforeSnapshot" JSONB,
    "afterSnapshot" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductCategory" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "parentId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "imageKey" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ProductCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductCategoryRelation" (
    "productId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,

    CONSTRAINT "ProductCategoryRelation_pkey" PRIMARY KEY ("productId","categoryId")
);

-- CreateTable
CREATE TABLE "MaterialCategory" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "MaterialCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaterialCategoryRelation" (
    "materialId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,

    CONSTRAINT "MaterialCategoryRelation_pkey" PRIMARY KEY ("materialId","categoryId")
);

-- CreateTable
CREATE TABLE "Banner" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "imageKey" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "targetKind" "ContentTargetKind" NOT NULL DEFAULT 'NONE',
    "targetValue" TEXT,
    "productId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "deleted" BOOLEAN NOT NULL DEFAULT false,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),

    CONSTRAINT "Banner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecommendationSlot" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slotType" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "maxItems" INTEGER NOT NULL DEFAULT 10,

    CONSTRAINT "RecommendationSlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecommendationItem" (
    "id" TEXT NOT NULL,
    "slotId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "skuId" TEXT,
    "titleOverride" TEXT,
    "imageOverrideKey" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),

    CONSTRAINT "RecommendationItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HomeSceneEntry" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "sceneKey" TEXT NOT NULL,
    "iconKey" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "targetKind" "ContentTargetKind" NOT NULL DEFAULT 'PRODUCT_FILTER',
    "targetValue" TEXT,
    "recommendationSlotId" TEXT,

    CONSTRAINT "HomeSceneEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_slug_key" ON "Tenant"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Store_tenantId_code_key" ON "Store"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Store_id_tenantId_key" ON "Store"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryLocation_storeId_code_key" ON "InventoryLocation"("storeId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Material_tenantId_code_key" ON "Material"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Material_id_tenantId_key" ON "Material"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_tenantId_code_key" ON "Supplier"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_id_tenantId_key" ON "Supplier"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Product_defaultSkuId_key" ON "Product"("defaultSkuId");

-- CreateIndex
CREATE UNIQUE INDEX "Product_tenantId_code_key" ON "Product"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Product_id_tenantId_key" ON "Product"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Product_id_defaultSkuId_key" ON "Product"("id", "defaultSkuId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductSku_productId_code_key" ON "ProductSku"("productId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "ProductSku_productId_id_key" ON "ProductSku"("productId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Recipe_skuId_key" ON "Recipe"("skuId");

-- CreateIndex
CREATE UNIQUE INDEX "RecipeVersion_recipeId_versionNo_key" ON "RecipeVersion"("recipeId", "versionNo");

-- CreateIndex
CREATE INDEX "RecipeLine_versionId_idx" ON "RecipeLine"("versionId");

-- CreateIndex
CREATE INDEX "Order_storeId_deliveryAt_idx" ON "Order"("storeId", "deliveryAt");

-- CreateIndex
CREATE UNIQUE INDEX "Order_tenantId_number_key" ON "Order"("tenantId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "OrderRevision_orderId_number_key" ON "OrderRevision"("orderId", "number");

-- CreateIndex
CREATE INDEX "OrderMaterialRequirement_materialId_needBy_idx" ON "OrderMaterialRequirement"("materialId", "needBy");

-- CreateIndex
CREATE INDEX "AvailabilityHold_skuId_state_expiresAt_idx" ON "AvailabilityHold"("skuId", "state", "expiresAt");

-- CreateIndex
CREATE INDEX "AvailabilityHoldMaterial_materialId_idx" ON "AvailabilityHoldMaterial"("materialId");

-- CreateIndex
CREATE UNIQUE INDEX "AvailabilityHoldMaterial_holdId_materialId_key" ON "AvailabilityHoldMaterial"("holdId", "materialId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_tenantId_number_key" ON "PurchaseOrder"("tenantId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "FutureSupplyAllocation_purchaseLineId_requirementId_key" ON "FutureSupplyAllocation"("purchaseLineId", "requirementId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseDemandAllocation_purchaseLineId_requirementId_key" ON "PurchaseDemandAllocation"("purchaseLineId", "requirementId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryBatch_receiptLineId_key" ON "InventoryBatch"("receiptLineId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryBatch_storeId_batchNo_key" ON "InventoryBatch"("storeId", "batchNo");

-- CreateIndex
CREATE UNIQUE INDEX "BatchBalance_batchId_locationId_key" ON "BatchBalance"("batchId", "locationId");

-- CreateIndex
CREATE INDEX "ConsumableRoll_locationId_state_idx" ON "ConsumableRoll"("locationId", "state");

-- CreateIndex
CREATE INDEX "InventoryReservation_batchId_state_idx" ON "InventoryReservation"("batchId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryTransaction_idempotencyKey_key" ON "InventoryTransaction"("idempotencyKey");

-- CreateIndex
CREATE INDEX "InventoryTransaction_batchId_createdAt_idx" ON "InventoryTransaction"("batchId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Sample_tenantId_code_key" ON "Sample"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "SampleMaterial_sampleId_materialId_key" ON "SampleMaterial"("sampleId", "materialId");

-- CreateIndex
CREATE UNIQUE INDEX "SamplePlanItem_planId_sampleId_key" ON "SamplePlanItem"("planId", "sampleId");

-- CreateIndex
CREATE UNIQUE INDEX "SamplePlanItem_planId_sequenceNo_key" ON "SamplePlanItem"("planId", "sequenceNo");

-- CreateIndex
CREATE UNIQUE INDEX "SamplePlanMaterial_planId_materialId_key" ON "SamplePlanMaterial"("planId", "materialId");

-- CreateIndex
CREATE UNIQUE INDEX "SamplePlanRun_planId_runNo_key" ON "SamplePlanRun"("planId", "runNo");

-- CreateIndex
CREATE UNIQUE INDEX "SamplePlanRun_planId_id_key" ON "SamplePlanRun"("planId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SamplePlanRun_calculationGroupId_rank_key" ON "SamplePlanRun"("calculationGroupId", "rank");

-- CreateIndex
CREATE UNIQUE INDEX "SamplePlanInventorySnapshot_runId_materialId_key" ON "SamplePlanInventorySnapshot"("runId", "materialId");

-- CreateIndex
CREATE UNIQUE INDEX "SamplePlanStep_runId_sequenceNo_key" ON "SamplePlanStep"("runId", "sequenceNo");

-- CreateIndex
CREATE UNIQUE INDEX "SamplePlanStepMaterial_stepId_materialId_key" ON "SamplePlanStepMaterial"("stepId", "materialId");

-- CreateIndex
CREATE UNIQUE INDEX "SamplePlanExecutionStep_executionId_plannedStepId_key" ON "SamplePlanExecutionStep"("executionId", "plannedStepId");

-- CreateIndex
CREATE INDEX "SampleDisassemblyMaterial_executionStepId_materialId_idx" ON "SampleDisassemblyMaterial"("executionStepId", "materialId");

-- CreateIndex
CREATE INDEX "SampleInventoryReservation_batchId_state_idx" ON "SampleInventoryReservation"("batchId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentTransaction_idempotencyKey_key" ON "PaymentTransaction"("idempotencyKey");

-- CreateIndex
CREATE INDEX "PaymentTransaction_orderId_state_idx" ON "PaymentTransaction"("orderId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "RefundTransaction_idempotencyKey_key" ON "RefundTransaction"("idempotencyKey");

-- CreateIndex
CREATE INDEX "RefundTransaction_orderId_createdAt_idx" ON "RefundTransaction"("orderId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Fulfillment_orderId_key" ON "Fulfillment"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryAttempt_fulfillmentId_attemptNo_key" ON "DeliveryAttempt"("fulfillmentId", "attemptNo");

-- CreateIndex
CREATE INDEX "CostEntry_orderId_stage_kind_idx" ON "CostEntry"("orderId", "stage", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "OrderCostSnapshot_orderId_revisionNo_key" ON "OrderCostSnapshot"("orderId", "revisionNo");

-- CreateIndex
CREATE INDEX "CostAdjustment_orderId_createdAt_idx" ON "CostAdjustment"("orderId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "StaffUser_username_key" ON "StaffUser"("username");

-- CreateIndex
CREATE UNIQUE INDEX "TenantMember_tenantId_staffUserId_key" ON "TenantMember"("tenantId", "staffUserId");

-- CreateIndex
CREATE UNIQUE INDEX "StoreMember_storeId_staffUserId_key" ON "StoreMember"("storeId", "staffUserId");

-- CreateIndex
CREATE UNIQUE INDEX "MiniProgramIdentity_tenantId_openId_key" ON "MiniProgramIdentity"("tenantId", "openId");

-- CreateIndex
CREATE INDEX "Customer_tenantId_phone_idx" ON "Customer"("tenantId", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerRecipientRelation_customerId_recipientId_key" ON "CustomerRecipientRelation"("customerId", "recipientId");

-- CreateIndex
CREATE INDEX "CustomerReminder_customerId_remindAt_idx" ON "CustomerReminder"("customerId", "remindAt");

-- CreateIndex
CREATE UNIQUE INDEX "StocktakeLine_stocktakeId_batchId_locationId_key" ON "StocktakeLine"("stocktakeId", "batchId", "locationId");

-- CreateIndex
CREATE INDEX "LossRecord_storeId_occurredAt_idx" ON "LossRecord"("storeId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "StoreSettings_storeId_key" ON "StoreSettings"("storeId");

-- CreateIndex
CREATE INDEX "AuditEvent_tenantId_occurredAt_idx" ON "AuditEvent"("tenantId", "occurredAt");

-- CreateIndex
CREATE INDEX "ProductCategory_tenantId_parentId_sortOrder_idx" ON "ProductCategory"("tenantId", "parentId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "ProductCategory_tenantId_code_key" ON "ProductCategory"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "MaterialCategory_tenantId_code_key" ON "MaterialCategory"("tenantId", "code");

-- CreateIndex
CREATE INDEX "Banner_tenantId_active_sortOrder_idx" ON "Banner"("tenantId", "active", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "RecommendationSlot_tenantId_key_key" ON "RecommendationSlot"("tenantId", "key");

-- CreateIndex
CREATE INDEX "RecommendationItem_slotId_active_sortOrder_idx" ON "RecommendationItem"("slotId", "active", "sortOrder");

-- CreateIndex
CREATE INDEX "HomeSceneEntry_tenantId_active_sortOrder_idx" ON "HomeSceneEntry"("tenantId", "active", "sortOrder");

-- AddForeignKey
ALTER TABLE "Store" ADD CONSTRAINT "Store_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryLocation" ADD CONSTRAINT "InventoryLocation_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Material" ADD CONSTRAINT "Material_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_id_defaultSkuId_fkey" FOREIGN KEY ("id", "defaultSkuId") REFERENCES "ProductSku"("productId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductSku" ADD CONSTRAINT "ProductSku_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductSku" ADD CONSTRAINT "ProductSku_sourceSampleId_fkey" FOREIGN KEY ("sourceSampleId") REFERENCES "Sample"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recipe" ADD CONSTRAINT "Recipe_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "ProductSku"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeVersion" ADD CONSTRAINT "RecipeVersion_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeLine" ADD CONSTRAINT "RecipeLine_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "RecipeVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeLine" ADD CONSTRAINT "RecipeLine_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "Recipient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "ProductSku"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_recipeVersionId_fkey" FOREIGN KEY ("recipeVersionId") REFERENCES "RecipeVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderRevision" ADD CONSTRAINT "OrderRevision_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderMaterialRequirement" ADD CONSTRAINT "OrderMaterialRequirement_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderMaterialRequirement" ADD CONSTRAINT "OrderMaterialRequirement_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "OrderRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderMaterialRequirement" ADD CONSTRAINT "OrderMaterialRequirement_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvailabilityHold" ADD CONSTRAINT "AvailabilityHold_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvailabilityHold" ADD CONSTRAINT "AvailabilityHold_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "ProductSku"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvailabilityHoldMaterial" ADD CONSTRAINT "AvailabilityHoldMaterial_holdId_fkey" FOREIGN KEY ("holdId") REFERENCES "AvailabilityHold"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvailabilityHoldMaterial" ADD CONSTRAINT "AvailabilityHoldMaterial_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FutureSupplyAllocation" ADD CONSTRAINT "FutureSupplyAllocation_purchaseLineId_fkey" FOREIGN KEY ("purchaseLineId") REFERENCES "PurchaseOrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FutureSupplyAllocation" ADD CONSTRAINT "FutureSupplyAllocation_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "OrderMaterialRequirement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseDemandAllocation" ADD CONSTRAINT "PurchaseDemandAllocation_purchaseLineId_fkey" FOREIGN KEY ("purchaseLineId") REFERENCES "PurchaseOrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseDemandAllocation" ADD CONSTRAINT "PurchaseDemandAllocation_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "OrderMaterialRequirement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceiptLine" ADD CONSTRAINT "GoodsReceiptLine_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "GoodsReceipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceiptLine" ADD CONSTRAINT "GoodsReceiptLine_purchaseLineId_fkey" FOREIGN KEY ("purchaseLineId") REFERENCES "PurchaseOrderLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceiptLine" ADD CONSTRAINT "GoodsReceiptLine_acceptedMaterialId_fkey" FOREIGN KEY ("acceptedMaterialId") REFERENCES "Material"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryBatch" ADD CONSTRAINT "InventoryBatch_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryBatch" ADD CONSTRAINT "InventoryBatch_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryBatch" ADD CONSTRAINT "InventoryBatch_receiptLineId_fkey" FOREIGN KEY ("receiptLineId") REFERENCES "GoodsReceiptLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatchBalance" ADD CONSTRAINT "BatchBalance_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "InventoryBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatchBalance" ADD CONSTRAINT "BatchBalance_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "InventoryLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsumableRoll" ADD CONSTRAINT "ConsumableRoll_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "InventoryBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsumableRoll" ADD CONSTRAINT "ConsumableRoll_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "InventoryLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryReservation" ADD CONSTRAINT "InventoryReservation_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "OrderMaterialRequirement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryReservation" ADD CONSTRAINT "InventoryReservation_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "InventoryBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryTransaction" ADD CONSTRAINT "InventoryTransaction_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "InventoryBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionTask" ADD CONSTRAINT "ProductionTask_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialUsage" ADD CONSTRAINT "MaterialUsage_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "ProductionTask"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialUsage" ADD CONSTRAINT "MaterialUsage_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "InventoryBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sample" ADD CONSTRAINT "Sample_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SampleMaterial" ADD CONSTRAINT "SampleMaterial_sampleId_fkey" FOREIGN KEY ("sampleId") REFERENCES "Sample"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SampleMaterial" ADD CONSTRAINT "SampleMaterial_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SamplePlan" ADD CONSTRAINT "SamplePlan_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SamplePlan" ADD CONSTRAINT "SamplePlan_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SamplePlanItem" ADD CONSTRAINT "SamplePlanItem_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SamplePlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SamplePlanItem" ADD CONSTRAINT "SamplePlanItem_sampleId_fkey" FOREIGN KEY ("sampleId") REFERENCES "Sample"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SamplePlanMaterial" ADD CONSTRAINT "SamplePlanMaterial_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SamplePlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SamplePlanMaterial" ADD CONSTRAINT "SamplePlanMaterial_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SamplePlanRun" ADD CONSTRAINT "SamplePlanRun_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SamplePlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SamplePlanInventorySnapshot" ADD CONSTRAINT "SamplePlanInventorySnapshot_runId_fkey" FOREIGN KEY ("runId") REFERENCES "SamplePlanRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SamplePlanInventorySnapshot" ADD CONSTRAINT "SamplePlanInventorySnapshot_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SamplePlanStep" ADD CONSTRAINT "SamplePlanStep_runId_fkey" FOREIGN KEY ("runId") REFERENCES "SamplePlanRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SamplePlanStep" ADD CONSTRAINT "SamplePlanStep_sampleId_fkey" FOREIGN KEY ("sampleId") REFERENCES "Sample"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SamplePlanStepMaterial" ADD CONSTRAINT "SamplePlanStepMaterial_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "SamplePlanStep"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SamplePlanStepMaterial" ADD CONSTRAINT "SamplePlanStepMaterial_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SamplePlanExecution" ADD CONSTRAINT "SamplePlanExecution_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SamplePlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SamplePlanExecution" ADD CONSTRAINT "SamplePlanExecution_planId_selectedRunId_fkey" FOREIGN KEY ("planId", "selectedRunId") REFERENCES "SamplePlanRun"("planId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SamplePlanExecutionStep" ADD CONSTRAINT "SamplePlanExecutionStep_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "SamplePlanExecution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SamplePlanExecutionStep" ADD CONSTRAINT "SamplePlanExecutionStep_plannedStepId_fkey" FOREIGN KEY ("plannedStepId") REFERENCES "SamplePlanStep"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SampleDisassemblyMaterial" ADD CONSTRAINT "SampleDisassemblyMaterial_executionStepId_fkey" FOREIGN KEY ("executionStepId") REFERENCES "SamplePlanExecutionStep"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SampleDisassemblyMaterial" ADD CONSTRAINT "SampleDisassemblyMaterial_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SampleInventoryReservation" ADD CONSTRAINT "SampleInventoryReservation_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "SamplePlanExecution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SampleInventoryReservation" ADD CONSTRAINT "SampleInventoryReservation_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "InventoryBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "PaymentTransaction_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundTransaction" ADD CONSTRAINT "RefundTransaction_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundTransaction" ADD CONSTRAINT "RefundTransaction_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "PaymentTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fulfillment" ADD CONSTRAINT "Fulfillment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryAttempt" ADD CONSTRAINT "DeliveryAttempt_fulfillmentId_fkey" FOREIGN KEY ("fulfillmentId") REFERENCES "Fulfillment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostEntry" ADD CONSTRAINT "CostEntry_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderCostSnapshot" ADD CONSTRAINT "OrderCostSnapshot_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostAdjustment" ADD CONSTRAINT "CostAdjustment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostAdjustment" ADD CONSTRAINT "CostAdjustment_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "OrderCostSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantMember" ADD CONSTRAINT "TenantMember_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantMember" ADD CONSTRAINT "TenantMember_staffUserId_fkey" FOREIGN KEY ("staffUserId") REFERENCES "StaffUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreMember" ADD CONSTRAINT "StoreMember_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreMember" ADD CONSTRAINT "StoreMember_staffUserId_fkey" FOREIGN KEY ("staffUserId") REFERENCES "StaffUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MiniProgramIdentity" ADD CONSTRAINT "MiniProgramIdentity_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recipient" ADD CONSTRAINT "Recipient_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerRecipientRelation" ADD CONSTRAINT "CustomerRecipientRelation_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerRecipientRelation" ADD CONSTRAINT "CustomerRecipientRelation_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "Recipient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiftOccasion" ADD CONSTRAINT "GiftOccasion_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiftOccasion" ADD CONSTRAINT "GiftOccasion_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "Recipient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerReminder" ADD CONSTRAINT "CustomerReminder_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Stocktake" ADD CONSTRAINT "Stocktake_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StocktakeLine" ADD CONSTRAINT "StocktakeLine_stocktakeId_fkey" FOREIGN KEY ("stocktakeId") REFERENCES "Stocktake"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StocktakeLine" ADD CONSTRAINT "StocktakeLine_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "InventoryBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StocktakeLine" ADD CONSTRAINT "StocktakeLine_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "InventoryLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LossRecord" ADD CONSTRAINT "LossRecord_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LossRecord" ADD CONSTRAINT "LossRecord_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "InventoryBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LossRecord" ADD CONSTRAINT "LossRecord_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreSettings" ADD CONSTRAINT "StoreSettings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreSettings" ADD CONSTRAINT "StoreSettings_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCategory" ADD CONSTRAINT "ProductCategory_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCategory" ADD CONSTRAINT "ProductCategory_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "ProductCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCategoryRelation" ADD CONSTRAINT "ProductCategoryRelation_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCategoryRelation" ADD CONSTRAINT "ProductCategoryRelation_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ProductCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialCategory" ADD CONSTRAINT "MaterialCategory_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialCategoryRelation" ADD CONSTRAINT "MaterialCategoryRelation_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialCategoryRelation" ADD CONSTRAINT "MaterialCategoryRelation_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "MaterialCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Banner" ADD CONSTRAINT "Banner_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Banner" ADD CONSTRAINT "Banner_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecommendationSlot" ADD CONSTRAINT "RecommendationSlot_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecommendationItem" ADD CONSTRAINT "RecommendationItem_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "RecommendationSlot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecommendationItem" ADD CONSTRAINT "RecommendationItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecommendationItem" ADD CONSTRAINT "RecommendationItem_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "ProductSku"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HomeSceneEntry" ADD CONSTRAINT "HomeSceneEntry_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HomeSceneEntry" ADD CONSTRAINT "HomeSceneEntry_recommendationSlotId_fkey" FOREIGN KEY ("recommendationSlotId") REFERENCES "RecommendationSlot"("id") ON DELETE SET NULL ON UPDATE CASCADE;
