-- CreateTable
CREATE TABLE "public"."scheduled_reports" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "schedule" TEXT NOT NULL,
    "recipients" JSONB NOT NULL DEFAULT '[]',
    "config" JSONB NOT NULL DEFAULT '{}',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "scheduled_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."report_exports" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "reportType" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "config" JSONB NOT NULL DEFAULT '{}',
    "filePath" TEXT,
    "fileSize" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "report_exports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."analytics_dashboards" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Default',
    "config" JSONB NOT NULL DEFAULT '{}',
    "layout" JSONB NOT NULL DEFAULT '{}',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "analytics_dashboards_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "scheduled_reports_tenantId_isActive_idx" ON "public"."scheduled_reports"("tenantId", "isActive");

-- CreateIndex
CREATE INDEX "report_exports_tenantId_status_idx" ON "public"."report_exports"("tenantId", "status");

-- CreateIndex
CREATE INDEX "analytics_dashboards_tenantId_idx" ON "public"."analytics_dashboards"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "analytics_dashboards_tenantId_name_key" ON "public"."analytics_dashboards"("tenantId", "name");

-- AddForeignKey
ALTER TABLE "public"."scheduled_reports" ADD CONSTRAINT "scheduled_reports_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."report_exports" ADD CONSTRAINT "report_exports_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."analytics_dashboards" ADD CONSTRAINT "analytics_dashboards_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
