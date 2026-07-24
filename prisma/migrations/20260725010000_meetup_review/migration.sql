-- CreateEnum
CREATE TYPE "ReviewRating" AS ENUM ('GOOD', 'OK', 'BAD');

-- AlterTable
ALTER TABLE "Escrow" ADD COLUMN     "meetupAt" TIMESTAMP(3),
ADD COLUMN     "meetupPlace" TEXT;

-- CreateTable
CREATE TABLE "TradeReview" (
    "id" TEXT NOT NULL,
    "escrowId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "rating" "ReviewRating" NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TradeReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TradeReview_targetId_idx" ON "TradeReview"("targetId");

-- CreateIndex
CREATE UNIQUE INDEX "TradeReview_escrowId_authorId_key" ON "TradeReview"("escrowId", "authorId");

-- AddForeignKey
ALTER TABLE "TradeReview" ADD CONSTRAINT "TradeReview_escrowId_fkey" FOREIGN KEY ("escrowId") REFERENCES "Escrow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeReview" ADD CONSTRAINT "TradeReview_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeReview" ADD CONSTRAINT "TradeReview_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

