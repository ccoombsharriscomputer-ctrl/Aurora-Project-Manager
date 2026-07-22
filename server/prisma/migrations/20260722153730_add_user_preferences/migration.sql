-- CreateEnum
CREATE TYPE "ThemeMode" AS ENUM ('LIGHT', 'DARK', 'SYSTEM');

-- CreateEnum
CREATE TYPE "AccentColor" AS ENUM ('BLUE', 'GREEN', 'PURPLE', 'ORANGE', 'RED', 'TEAL');

-- CreateEnum
CREATE TYPE "Locale" AS ENUM ('EN', 'ES', 'FR_CA');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "accentColor" "AccentColor" NOT NULL DEFAULT 'BLUE',
ADD COLUMN     "locale" "Locale" NOT NULL DEFAULT 'EN',
ADD COLUMN     "theme" "ThemeMode" NOT NULL DEFAULT 'SYSTEM';
