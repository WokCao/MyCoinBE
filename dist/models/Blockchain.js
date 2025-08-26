"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Blockchain = void 0;
// src/models/Blockchain.ts
const Block_1 = require("./Block");
const Transaction_1 = require("./Transaction");
const client_1 = require("@prisma/client");
require("dotenv").config();
const prisma = new client_1.PrismaClient();
const BLOCK_GENERATION_INTERVAL = Number(process.env.BLOCK_GENERATION_INTERVAL) || 10;
const DIFFICULTY_ADJUSTMENT_INTERVAL = Number(process.env.DIFFICULTY_ADJUSTMENT_INTERVAL) || 10;
class Blockchain {
    constructor(consensusMode = "pow") {
        this.chain = [this.createGenesisBlock()];
        this.pendingTransactions = [];
        this.miningReward = 0.01;
        this.consensusMode = consensusMode;
        this.stakeMap = {};
        this.unspentTxOuts = [];
    }
    createGenesisBlock() {
        return new Block_1.Block(0, [], "0");
    }
    getLatestBlock() {
        return this.chain[this.chain.length - 1];
    }
    getDifficulty(aBlockchain) {
        var _a;
        const latestBlock = aBlockchain[aBlockchain.length - 1];
        if (latestBlock.index % DIFFICULTY_ADJUSTMENT_INTERVAL === 0 &&
            latestBlock.index !== 0) {
            return this.getAdjustedDifficulty(latestBlock, aBlockchain);
        }
        else {
            return (_a = latestBlock.difficulty) !== null && _a !== void 0 ? _a : 3;
        }
    }
    getAdjustedDifficulty(latestBlock, aBlockchain) {
        const prevAdjustmentBlock = aBlockchain[aBlockchain.length - DIFFICULTY_ADJUSTMENT_INTERVAL];
        const timeExpected = BLOCK_GENERATION_INTERVAL * DIFFICULTY_ADJUSTMENT_INTERVAL;
        const timeTaken = latestBlock.timestamp - prevAdjustmentBlock.timestamp;
        if (timeTaken < timeExpected / 2) {
            return prevAdjustmentBlock.difficulty + 1;
        }
        else if (timeTaken > timeExpected * 2) {
            return prevAdjustmentBlock.difficulty - 1;
        }
        else {
            return prevAdjustmentBlock.difficulty;
        }
    }
    // PoW Mining (with selected transactions)
    async mineSelectedByIds(txIds, minerAddress, isFaucet = false) {
        if (this.consensusMode !== "pow")
            throw new Error("Blockchain is in PoS mode");
        let selectedTxs = this.pendingTransactions.filter(tx => txIds.includes(tx.id));
        if (!isFaucet) {
            const rewardTx = (0, Transaction_1.createCoinbaseTx)(minerAddress, this.miningReward);
            this.pendingTransactions.push(rewardTx);
            selectedTxs.push(rewardTx);
        }
        if (selectedTxs.length === 0) {
            throw new Error("No valid transactions selected to mine");
        }
        const difficulty = this.getDifficulty(this.chain);
        const block = new Block_1.Block(this.chain.length, selectedTxs, this.getLatestBlock().hash, difficulty);
        block.mineBlock();
        this.chain.push(block);
        await this.saveBlockToDB(block);
        // update UTXO
        this.updateUnspentTxOuts(selectedTxs);
        // remove mined transactions
        this.pendingTransactions = this.pendingTransactions.filter(tx => {
            return !selectedTxs.find(stx => stx.id === tx.id);
        });
    }
    addTransaction(tx) {
        if (!(0, Transaction_1.isValidTransaction)(tx, this.unspentTxOuts)) {
            throw new Error("Invalid transaction");
        }
        this.pendingTransactions.push(tx);
    }
    updateUnspentTxOuts(transactions) {
        const newUnspentTxOuts = [];
        transactions.forEach(tx => {
            tx.txOuts.forEach((txOut, index) => {
                newUnspentTxOuts.push(new Transaction_1.UnspentTxOut(tx.id, index, txOut.address, txOut.amount));
            });
        });
        transactions.forEach(tx => {
            tx.txIns.forEach(txIn => {
                const consumedUTxO = (0, Transaction_1.findUnspentTxOut)(txIn.txOutId, txIn.txOutIndex, this.unspentTxOuts);
                if (consumedUTxO) {
                    this.unspentTxOuts = this.unspentTxOuts.filter(uTxO => uTxO.txOutId !== consumedUTxO.txOutId ||
                        uTxO.txOutIndex !== consumedUTxO.txOutIndex);
                }
            });
        });
        this.unspentTxOuts.push(...newUnspentTxOuts);
    }
    getBalanceOfAddress(address) {
        console.log(`Calculating balance for address: ${address}`);
        console.log(`Current UTXOs: ${JSON.stringify(this.unspentTxOuts)}`);
        return this.unspentTxOuts
            .filter(uTxO => uTxO.address === address)
            .reduce((total, uTxO) => total + uTxO.amount, 0);
    }
    async saveBlockToDB(block) {
        var _a, _b, _c;
        try {
            // Lưu block trước
            const blockRecord = await prisma.block.create({
                data: {
                    index: block.index,
                    hash: block.hash,
                    previousHash: block.previousHash,
                    timestamp: BigInt(block.timestamp),
                    nonce: (_a = block.nonce) !== null && _a !== void 0 ? _a : 0,
                    difficulty: (_b = block.difficulty) !== null && _b !== void 0 ? _b : 0
                }
            });
            // Lưu transactions
            for (const tx of block.transactions) {
                const txRecord = await prisma.transaction.create({
                    data: {
                        txId: tx.id,
                        blockId: blockRecord.id,
                        timestamp: BigInt(tx.timestamp),
                    }
                });
                // Lưu txOuts
                for (let i = 0; i < tx.txOuts.length; i++) {
                    const txOut = tx.txOuts[i];
                    await prisma.txOut.create({
                        data: {
                            address: txOut.address,
                            amount: txOut.amount,
                            txIndex: i,
                            transactionId: txRecord.id
                        }
                    });
                }
                // Lưu txIns
                for (const txIn of tx.txIns) {
                    await prisma.txIn.create({
                        data: {
                            txOutId: txIn.txOutId,
                            txOutIndex: txIn.txOutIndex,
                            signature: (_c = txIn.signature) !== null && _c !== void 0 ? _c : null,
                            transactionId: txRecord.id
                        }
                    });
                }
            }
        }
        catch (err) {
            console.error("Failed to save block:", err);
        }
    }
}
exports.Blockchain = Blockchain;
