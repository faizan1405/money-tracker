-- CreateTable
CREATE TABLE `Owner` (
    `id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `passwordHash` VARCHAR(255) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Owner_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Session` (
    `id` VARCHAR(191) NOT NULL,
    `ownerId` VARCHAR(191) NOT NULL,
    `tokenHash` CHAR(64) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `userAgent` VARCHAR(255) NULL,
    `ip` VARCHAR(64) NULL,

    UNIQUE INDEX `Session_tokenHash_key`(`tokenHash`),
    INDEX `Session_ownerId_idx`(`ownerId`),
    INDEX `Session_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Workspace` (
    `id` VARCHAR(191) NOT NULL,
    `ownerId` VARCHAR(191) NOT NULL,
    `key` VARCHAR(40) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `short` VARCHAR(40) NOT NULL,
    `kind` VARCHAR(16) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Workspace_ownerId_key_key`(`ownerId`, `key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Account` (
    `id` VARCHAR(191) NOT NULL,
    `ownerId` VARCHAR(191) NOT NULL,
    `workspace` VARCHAR(40) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `institution` VARCHAR(120) NOT NULL,
    `kind` VARCHAR(16) NOT NULL,
    `openingBalancePaise` BIGINT NOT NULL DEFAULT 0,
    `creditLimitPaise` BIGINT NULL,
    `last4` VARCHAR(4) NULL,
    `reconciled` VARCHAR(16) NOT NULL DEFAULT 'never',
    `archived` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Account_ownerId_workspace_idx`(`ownerId`, `workspace`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Category` (
    `id` VARCHAR(191) NOT NULL,
    `ownerId` VARCHAR(191) NOT NULL,
    `workspace` VARCHAR(40) NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `kind` VARCHAR(16) NOT NULL,
    `parentId` VARCHAR(191) NULL,
    `custom` BOOLEAN NOT NULL DEFAULT true,

    UNIQUE INDEX `Category_ownerId_workspace_name_key`(`ownerId`, `workspace`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Transaction` (
    `id` VARCHAR(191) NOT NULL,
    `ownerId` VARCHAR(191) NOT NULL,
    `date` DATE NOT NULL,
    `type` VARCHAR(24) NOT NULL,
    `amountPaise` BIGINT NOT NULL,
    `adjustmentSign` INTEGER NULL,
    `interestPaise` BIGINT NULL,
    `description` VARCHAR(255) NOT NULL,
    `merchant` VARCHAR(160) NOT NULL,
    `category` VARCHAR(80) NOT NULL,
    `subcategory` VARCHAR(80) NULL,
    `workspace` VARCHAR(40) NOT NULL,
    `accountId` VARCHAR(191) NOT NULL,
    `toAccountId` VARCHAR(191) NULL,
    `client` VARCHAR(160) NULL,
    `project` VARCHAR(160) NULL,
    `notes` TEXT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'cleared',
    `recurring` BOOLEAN NOT NULL DEFAULT false,
    `source` VARCHAR(16) NOT NULL DEFAULT 'manual',
    `ref` VARCHAR(120) NULL,
    `importId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Transaction_ownerId_date_idx`(`ownerId`, `date`),
    INDEX `Transaction_ownerId_workspace_date_idx`(`ownerId`, `workspace`, `date`),
    UNIQUE INDEX `Transaction_ownerId_accountId_ref_key`(`ownerId`, `accountId`, `ref`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Client` (
    `id` VARCHAR(191) NOT NULL,
    `ownerId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(160) NOT NULL,
    `email` VARCHAR(191) NULL,

    UNIQUE INDEX `Client_ownerId_name_key`(`ownerId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Project` (
    `id` VARCHAR(191) NOT NULL,
    `ownerId` VARCHAR(191) NOT NULL,
    `clientId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(160) NOT NULL,
    `valuePaise` BIGINT NOT NULL DEFAULT 0,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Invoice` (
    `id` VARCHAR(191) NOT NULL,
    `ownerId` VARCHAR(191) NOT NULL,
    `clientId` VARCHAR(191) NOT NULL,
    `projectId` VARCHAR(191) NULL,
    `number` VARCHAR(40) NOT NULL,
    `issueDate` DATE NOT NULL,
    `dueDate` DATE NOT NULL,
    `amountPaise` BIGINT NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'draft',

    UNIQUE INDEX `Invoice_ownerId_number_key`(`ownerId`, `number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `InvoicePayment` (
    `id` VARCHAR(191) NOT NULL,
    `invoiceId` VARCHAR(191) NOT NULL,
    `transactionId` VARCHAR(191) NULL,
    `date` DATE NOT NULL,
    `amountPaise` BIGINT NOT NULL,

    UNIQUE INDEX `InvoicePayment_transactionId_key`(`transactionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Loan` (
    `id` VARCHAR(191) NOT NULL,
    `ownerId` VARCHAR(191) NOT NULL,
    `workspace` VARCHAR(40) NOT NULL,
    `direction` VARCHAR(16) NOT NULL,
    `kind` VARCHAR(16) NOT NULL,
    `party` VARCHAR(160) NOT NULL,
    `principalPaise` BIGINT NOT NULL,
    `outstandingPaise` BIGINT NOT NULL,
    `dueDate` DATE NOT NULL,
    `interestRateBp` INTEGER NULL,
    `emiPaise` BIGINT NULL,
    `notes` TEXT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LoanRepayment` (
    `id` VARCHAR(191) NOT NULL,
    `loanId` VARCHAR(191) NOT NULL,
    `transactionId` VARCHAR(191) NULL,
    `date` DATE NOT NULL,
    `amountPaise` BIGINT NOT NULL,
    `interestPaise` BIGINT NOT NULL DEFAULT 0,

    UNIQUE INDEX `LoanRepayment_transactionId_key`(`transactionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Budget` (
    `id` VARCHAR(191) NOT NULL,
    `ownerId` VARCHAR(191) NOT NULL,
    `workspace` VARCHAR(40) NOT NULL,
    `category` VARCHAR(80) NOT NULL,
    `limitPaise` BIGINT NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Goal` (
    `id` VARCHAR(191) NOT NULL,
    `ownerId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `targetPaise` BIGINT NOT NULL,
    `savedPaise` BIGINT NOT NULL DEFAULT 0,
    `deadline` DATE NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Recurring` (
    `id` VARCHAR(191) NOT NULL,
    `ownerId` VARCHAR(191) NOT NULL,
    `workspace` VARCHAR(40) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `amountPaise` BIGINT NOT NULL,
    `category` VARCHAR(80) NOT NULL,
    `nextDate` DATE NOT NULL,
    `cadence` VARCHAR(16) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Rule` (
    `id` VARCHAR(191) NOT NULL,
    `ownerId` VARCHAR(191) NOT NULL,
    `workspace` VARCHAR(40) NOT NULL,
    `match` VARCHAR(120) NOT NULL,
    `category` VARCHAR(80) NOT NULL,
    `priority` INTEGER NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StatementImport` (
    `id` VARCHAR(191) NOT NULL,
    `ownerId` VARCHAR(191) NOT NULL,
    `accountId` VARCHAR(191) NOT NULL,
    `workspace` VARCHAR(40) NOT NULL,
    `fileName` VARCHAR(255) NOT NULL,
    `status` VARCHAR(16) NOT NULL,
    `error` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AuditLog` (
    `id` VARCHAR(191) NOT NULL,
    `ownerId` VARCHAR(191) NOT NULL,
    `action` VARCHAR(60) NOT NULL,
    `entity` VARCHAR(40) NOT NULL,
    `entityId` VARCHAR(64) NULL,
    `detail` JSON NULL,
    `ip` VARCHAR(64) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AuditLog_ownerId_createdAt_idx`(`ownerId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Session` ADD CONSTRAINT `Session_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `Owner`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Workspace` ADD CONSTRAINT `Workspace_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `Owner`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Account` ADD CONSTRAINT `Account_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `Owner`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Category` ADD CONSTRAINT `Category_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `Owner`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Category` ADD CONSTRAINT `Category_parentId_fkey` FOREIGN KEY (`parentId`) REFERENCES `Category`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Transaction` ADD CONSTRAINT `Transaction_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `Owner`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Transaction` ADD CONSTRAINT `Transaction_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `Account`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Transaction` ADD CONSTRAINT `Transaction_toAccountId_fkey` FOREIGN KEY (`toAccountId`) REFERENCES `Account`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Transaction` ADD CONSTRAINT `Transaction_importId_fkey` FOREIGN KEY (`importId`) REFERENCES `StatementImport`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Client` ADD CONSTRAINT `Client_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `Owner`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Project` ADD CONSTRAINT `Project_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `Owner`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Project` ADD CONSTRAINT `Project_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `Client`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Invoice` ADD CONSTRAINT `Invoice_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `Owner`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Invoice` ADD CONSTRAINT `Invoice_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `Client`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Invoice` ADD CONSTRAINT `Invoice_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `Project`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `InvoicePayment` ADD CONSTRAINT `InvoicePayment_invoiceId_fkey` FOREIGN KEY (`invoiceId`) REFERENCES `Invoice`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Loan` ADD CONSTRAINT `Loan_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `Owner`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LoanRepayment` ADD CONSTRAINT `LoanRepayment_loanId_fkey` FOREIGN KEY (`loanId`) REFERENCES `Loan`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Budget` ADD CONSTRAINT `Budget_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `Owner`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Goal` ADD CONSTRAINT `Goal_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `Owner`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Recurring` ADD CONSTRAINT `Recurring_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `Owner`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Rule` ADD CONSTRAINT `Rule_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `Owner`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StatementImport` ADD CONSTRAINT `StatementImport_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `Owner`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AuditLog` ADD CONSTRAINT `AuditLog_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `Owner`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

