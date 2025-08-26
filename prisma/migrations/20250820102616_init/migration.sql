-- CreateTable
CREATE TABLE "Block" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "index" INTEGER NOT NULL,
    "hash" TEXT NOT NULL,
    "previousHash" TEXT NOT NULL,
    "timestamp" BIGINT NOT NULL,
    "nonce" INTEGER,
    "difficulty" INTEGER
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "from" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "timestamp" BIGINT NOT NULL,
    "signature" TEXT,
    "blockId" INTEGER,
    CONSTRAINT "Transaction_blockId_fkey" FOREIGN KEY ("blockId") REFERENCES "Block" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
