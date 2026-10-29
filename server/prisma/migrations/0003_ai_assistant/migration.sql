-- Phase 3B: persistent AI usage/budget and assistant conversations.
CREATE TABLE `AiUsage` (
  `id` VARCHAR(191) NOT NULL,
  `ownerId` VARCHAR(191) NOT NULL,
  `feature` VARCHAR(32) NOT NULL,
  `model` VARCHAR(100) NOT NULL,
  `status` VARCHAR(16) NOT NULL,
  `day` CHAR(10) NOT NULL,
  `month` CHAR(7) NOT NULL,
  `reservedMicroUsd` INTEGER NOT NULL DEFAULT 0,
  `costMicroUsd` INTEGER NOT NULL DEFAULT 0,
  `promptTokens` INTEGER NOT NULL DEFAULT 0,
  `completionTokens` INTEGER NOT NULL DEFAULT 0,
  `ms` INTEGER NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `AiUsage_ownerId_day_idx`(`ownerId`, `day`),
  INDEX `AiUsage_ownerId_month_idx`(`ownerId`, `month`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `AiConversation` (
  `id` VARCHAR(191) NOT NULL,
  `ownerId` VARCHAR(191) NOT NULL,
  `title` VARCHAR(120) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `AiConversation_ownerId_updatedAt_idx`(`ownerId`, `updatedAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `AiMessage` (
  `id` VARCHAR(191) NOT NULL,
  `conversationId` VARCHAR(191) NOT NULL,
  `role` VARCHAR(16) NOT NULL,
  `content` TEXT NOT NULL,
  `data` JSON NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `AiMessage_conversationId_createdAt_idx`(`conversationId`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `AiUsage` ADD CONSTRAINT `AiUsage_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `Owner`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `AiConversation` ADD CONSTRAINT `AiConversation_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `Owner`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `AiMessage` ADD CONSTRAINT `AiMessage_conversationId_fkey` FOREIGN KEY (`conversationId`) REFERENCES `AiConversation`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
