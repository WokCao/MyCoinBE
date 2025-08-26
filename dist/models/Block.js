"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Block = void 0;
const crypto_1 = __importDefault(require("crypto"));
class Block {
    constructor(index, transactions, previousHash = "", difficulty = 3) {
        this.index = index;
        this.timestamp = Date.now();
        this.transactions = transactions;
        this.previousHash = previousHash;
        this.nonce = 0;
        this.difficulty = difficulty;
        this.hash = this.calculateHash();
    }
    calculateHash() {
        return crypto_1.default.createHash("sha256")
            .update(this.index +
            this.previousHash +
            this.timestamp +
            JSON.stringify(this.transactions) +
            this.nonce)
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
exports.Block = Block;
