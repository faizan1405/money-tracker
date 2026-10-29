-- Phase 3A: statement review rows + summary. Raw files are never stored.
ALTER TABLE `StatementImport`
    ADD COLUMN `fileHash` VARCHAR(64) NOT NULL DEFAULT '',
    ADD COLUMN `summary` JSON NULL,
    ADD COLUMN `rows` JSON NULL,
    ADD COLUMN `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

CREATE INDEX `StatementImport_ownerId_createdAt_idx` ON `StatementImport`(`ownerId`, `createdAt`);
CREATE INDEX `StatementImport_ownerId_accountId_fileHash_idx` ON `StatementImport`(`ownerId`, `accountId`, `fileHash`);
