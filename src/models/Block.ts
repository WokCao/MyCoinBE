import crypto from "crypto";
import { Transaction } from "./Transaction";

export class Block {
  index: number;
  timestamp: number;
  transactions: Transaction[];
  previousHash: string;
  hash: string;
  nonce: number;
  difficulty: number;
  minerAddress: string;

  constructor(
    index: number,
    transactions: Transaction[],
    previousHash: string = "",
    difficulty: number = 4,
    minerAddress: string = ""
  ) {
    this.index = index;
    this.timestamp = Date.now();
    this.transactions = transactions;
    this.previousHash = previousHash;
    this.nonce = 0;
    this.difficulty = difficulty;
    this.hash = this.calculateHash();
    this.minerAddress = minerAddress;
  }

  calculateHash(): string {
    return crypto.createHash("sha256")
      .update(
        this.index +
          this.previousHash +
          this.timestamp +
          JSON.stringify(this.transactions) +
          this.nonce
      )
      .digest("hex");
  }

  mineBlock() {
    let i = 0;
    const target = "0".repeat(this.difficulty);
    while (!this.hash.startsWith(target)) {
      this.nonce++;
      this.hash = this.calculateHash();
      i++;
    }
    console.log(`Block mined: ${this.hash} after ${i} attempts`);
  }
}
