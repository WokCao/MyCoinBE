// src/models/Blockchain.ts
import { Block } from "./Block";
import {
    Transaction,
    createCoinbaseTx,
    isValidTransaction,
    findUnspentTxOut,
} from "./Transaction";
import { PrismaClient } from "@prisma/client";
import { UnspentTxOut } from "./UnspentTxOut";
require("dotenv").config();

const prisma = new PrismaClient();
const BLOCK_GENERATION_INTERVAL = Number(process.env.BLOCK_GENERATION_INTERVAL) || 10;
const DIFFICULTY_ADJUSTMENT_INTERVAL = Number(process.env.DIFFICULTY_ADJUSTMENT_INTERVAL) || 10;

export class Blockchain {
    chain: Block[];
    pendingTransactions: Transaction[];
    miningReward: number;
    consensusMode: "pow" | "pos";
    validatorAddress: string | null = null; // For PoS
    stakeMap: { [address: string]: number };
    unspentTxOuts: UnspentTxOut[];
    minStakeAmount: number;

    constructor(consensusMode: "pow" | "pos" = "pow") {
        this.chain = [this.createGenesisBlock()];
        this.pendingTransactions = [];
        this.miningReward = 0.01;
        this.consensusMode = consensusMode;
        this.validatorAddress = null;
        this.stakeMap = {};
        this.unspentTxOuts = [];
        this.minStakeAmount = 100;
    }

    createGenesisBlock(): Block {
        return new Block(0, [], "0");
    }

    getLatestBlock(): Block {
        return this.chain[this.chain.length - 1];
    }

    getDifficulty(aBlockchain: Block[]): number {
        const latestBlock = aBlockchain[aBlockchain.length - 1];
        if (
            latestBlock.index % DIFFICULTY_ADJUSTMENT_INTERVAL === 0 &&
            latestBlock.index !== 0
        ) {
            return this.getAdjustedDifficulty(latestBlock, aBlockchain);
        } else {
            return latestBlock.difficulty ?? 4;
        }
    }

    getAdjustedDifficulty(latestBlock: Block, aBlockchain: Block[]): number {
        const prevAdjustmentBlock =
            aBlockchain[aBlockchain.length - DIFFICULTY_ADJUSTMENT_INTERVAL];
        const timeExpected = BLOCK_GENERATION_INTERVAL * DIFFICULTY_ADJUSTMENT_INTERVAL;
        const timeTaken = latestBlock.timestamp - prevAdjustmentBlock.timestamp;

        if (timeTaken < timeExpected / 2) {
            return prevAdjustmentBlock.difficulty! + 1;
        } else if (timeTaken > timeExpected * 2) {
            return prevAdjustmentBlock.difficulty! - 1;
        } else {
            return prevAdjustmentBlock.difficulty!;
        }
    }

    // For PoS: add stake for an address
    async stake(address: string, amount: number) {
        // Kiểm tra số dư
        const balance = this.getBalanceOfAddress(address);
        if (balance < amount) {
            throw new Error("Insufficient balance for staking");
        }

        // Cập nhật stake
        if (!this.stakeMap[address]) {
            this.stakeMap[address] = 0;
        }
        this.stakeMap[address] += amount;

        // Lưu DB
        await prisma.stake.upsert({
            where: { address },
            update: { amount: this.stakeMap[address] },
            create: { address, amount: this.stakeMap[address] }
        });

        // Xác định validator mới
        this.updateValidator();
    }

    async unstake(address: string, amount: number) {
        if (!this.stakeMap[address] || this.stakeMap[address] < amount) {
            throw new Error("Insufficient staked amount");
        }

        this.stakeMap[address] -= amount;

        // Lưu DB
        await prisma.stake.update({
            where: { address },
            data: { amount: this.stakeMap[address] }
        });

        // Nếu unstake hết thì xoá khỏi DB
        if (this.stakeMap[address] === 0) {
            delete this.stakeMap[address];
            await prisma.stake.delete({ where: { address } });
        }

        // Xác định validator mới
        this.updateValidator();
    }

    // Hàm tìm validator nhiều stake nhất
    private updateValidator() {
        let maxStake = 0;
        let newValidator: string | null = null;

        for (const [addr, amount] of Object.entries(this.stakeMap)) {
            if (amount > maxStake && amount >= this.minStakeAmount) {
                maxStake = amount;
                newValidator = addr;
            }
        }

        this.validatorAddress = newValidator;
    }

    getValidatorInfo(): { validator: string | null; stakedAmount: number } {
        if (!this.validatorAddress) {
            return { validator: null, stakedAmount: 0 };
        }

        return {
            validator: this.validatorAddress,
            stakedAmount: this.stakeMap[this.validatorAddress] || 0
        };
    }

    async createBlockPoS(txIds: string[] = []) {
        if (!this.validatorAddress) {
            throw new Error("No validator available");
        }

        // Kiểm tra validator có đủ stake không
        if ((this.stakeMap[this.validatorAddress] || 0) < this.minStakeAmount) {
            throw new Error("Validator does not meet minimum stake requirement");
        }

        // Lấy các transaction từ pendingTransactions
        let selectedTxs = this.pendingTransactions.filter(tx => txIds.includes(tx.id));

        const newBlock = new Block(
            this.chain.length,
            selectedTxs,
            this.getLatestBlock().hash,
            0, // Difficulty không cần trong PoS
            this.validatorAddress
        );

        // Thưởng cho validator
        const rewardTx = createCoinbaseTx(this.validatorAddress, this.miningReward);
        newBlock.transactions.push(rewardTx);

        // Tính hash cho block (không cần mining)
        newBlock.hash = newBlock.calculateHash();
        newBlock.timestamp = Date.now();

        // Thêm block vào chain
        this.chain.push(newBlock);

        // Lưu block vào database
        await this.saveBlockToDB(newBlock);

        // Cập nhật unspent transaction outputs
        this.updateUnspentTxOuts(newBlock.transactions);

        // remove mined transactions
        this.pendingTransactions = this.pendingTransactions.filter(tx => {
            return !selectedTxs.find(stx => stx.id === tx.id);
        });

        // remove pending transactions to DB
        await prisma.pendingTransaction.deleteMany({
            where: { txId: { in: selectedTxs.map(tx => tx.id) } }
        });
    }

    // Calculate all the current coins in the blockchain
    calculateTotalCoins(): number {
        return this.unspentTxOuts.reduce((total, uTxO) => total + uTxO.amount, 0);
    }

    // Calculate number of confirmed transactions
    calculateConfirmedTransactions(): number {
        return this.chain.reduce((total, block) => total + block.transactions.length, 0)
    }

    // PoW Mining (with selected transactions)
    async mineSelectedByIds(txIds: string[], minerAddress: string, isFaucet: boolean = false, transactions: Transaction[] = []) {
        let selectedTxs = this.pendingTransactions.filter(tx => txIds.includes(tx.id));

        if (isFaucet) {
            selectedTxs = transactions;
        }

        if (selectedTxs.length === 0) {
            throw new Error("No valid transactions selected to mine");
        }

        if (!isFaucet) {
            const rewardTx = createCoinbaseTx(minerAddress, this.miningReward);
            selectedTxs.push(rewardTx);
        }


        const difficulty = this.getDifficulty(this.chain);
        const block = new Block(
            this.chain.length,
            selectedTxs,
            this.getLatestBlock().hash,
            difficulty,
            minerAddress
        );

        block.mineBlock();
        block.timestamp = Date.now();
        this.chain.push(block);
        await this.saveBlockToDB(block);

        // update UTXO
        this.updateUnspentTxOuts(selectedTxs);

        if (!isFaucet) {
            // remove mined transactions
            this.pendingTransactions = this.pendingTransactions.filter(tx => {
                return !selectedTxs.find(stx => stx.id === tx.id);
            });

            // remove pending transactions to DB
            await prisma.pendingTransaction.deleteMany({
                where: { txId: { in: selectedTxs.map(tx => tx.id) } }
            });
        }
    }

    // Add a new transaction to the pending transactions
    async addTransaction(tx: Transaction) {
        if (tx.txIns && tx.txIns[0].txOutIndex !== -1) {
            if (!isValidTransaction(tx, this.unspentTxOuts)) {
                throw new Error("Invalid transaction");
            }
        }

        this.pendingTransactions.push(tx);
        await this.savePendingTransactionToDB(tx);
    }

    // Get all UTXOs that are in the pending transactions
    getSpentUTXOsInPending(): Set<string> {
        const spentUTxOs = new Set<string>();

        for (const tx of this.pendingTransactions) {
            for (const txIn of tx.txIns) {
                const key = `${txIn.txOutId}:${txIn.txOutIndex}`;
                spentUTxOs.add(key);
            }
        }

        return spentUTxOs;
    }

    // Update unspent transaction outputs after mining
    updateUnspentTxOuts(transactions: Transaction[]) {
        const newUnspentTxOuts: UnspentTxOut[] = [];

        transactions.forEach(tx => {
            tx.txOuts.forEach((txOut, index) => {
                newUnspentTxOuts.push(
                    new UnspentTxOut(tx.id, index, txOut.address, txOut.amount)
                );
            });
        });

        transactions.forEach(tx => {
            tx.txIns.forEach(txIn => {
                const consumedUTxO = findUnspentTxOut(
                    txIn.txOutId,
                    txIn.txOutIndex,
                    this.unspentTxOuts
                );
                if (consumedUTxO) {
                    this.unspentTxOuts = this.unspentTxOuts.filter(
                        uTxO =>
                            uTxO.txOutId !== consumedUTxO.txOutId ||
                            uTxO.txOutIndex !== consumedUTxO.txOutIndex
                    );
                }
            });
        });

        this.unspentTxOuts.push(...newUnspentTxOuts);
        console.log("Updated UTXOs:", this.unspentTxOuts);
    }

    // Get balance of an address
    getBalanceOfAddress(address: string): number {
        let balance = this.unspentTxOuts
            .filter(uTxO => uTxO.address === address)
            .reduce((total, uTxO) => total + uTxO.amount, 0);

        console.log(`Initial balance from UTXOs: ${balance}`);

        const spentUTxOs = new Set<string>();

        for (const tx of this.pendingTransactions) {
            let isSender = false;

            for (const txIn of tx.txIns) {
                const key = `${txIn.txOutId}:${txIn.txOutIndex}`;
                if (spentUTxOs.has(key)) continue;
                const referencedUTxO = this.unspentTxOuts.find(
                    u => u.txOutId === txIn.txOutId && u.txOutIndex === txIn.txOutIndex
                );
                if (referencedUTxO && referencedUTxO.address === address) {
                    console.log(`Subtracting pending spent UTXO: ${JSON.stringify(referencedUTxO)}`);
                    balance -= referencedUTxO.amount;
                    spentUTxOs.add(key);
                    isSender = true;
                }
            }

            // Nếu là người gửi, cộng lại các TxOut của transaction
            if (isSender) {
                for (const txOut of tx.txOuts) {
                    if (txOut.address === address) {
                        console.log(`Adding back change output for ${address}: ${txOut.amount}`);
                        balance += txOut.amount;
                    }
                }
            }
        }

        if (this.stakeMap[address]) {
            console.log(`Subtracting staked amount: ${this.stakeMap[address]}`);
            balance -= this.stakeMap[address];
        }

        return balance;
    }

    // Save pending transactions to database
    async savePendingTransactionToDB(tx: Transaction | null = null) {
        try {
            // Lưu pending transactions
            if (tx) {
                const txRecord = await prisma.pendingTransaction.create({
                    data: {
                        txId: tx.id,
                        publicKey: tx.publicKey,
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
                            txIndex: txOut.txIndex,
                            pendingTransactionId: txRecord.id,
                            transactionId: null
                        }
                    });
                }

                // Lưu txIns
                for (const txIn of tx.txIns) {
                    await prisma.txIn.create({
                        data: {
                            txOutId: txIn.txOutId,
                            txOutIndex: txIn.txOutIndex,
                            signature: txIn.signature ?? null,
                            pendingTransactionId: txRecord.id,
                            transactionId: null
                        }
                    });
                }
            }
        } catch (err) {
            console.error("Failed to save pending transactions:", err);
        }
    }

    // Save block to database
    async saveBlockToDB(block: Block) {
        try {
            // Lưu block trước
            const blockRecord = await prisma.block.create({
                data: {
                    index: block.index,
                    hash: block.hash,
                    previousHash: block.previousHash,
                    timestamp: BigInt(block.timestamp),
                    nonce: block.nonce ?? 0,
                    difficulty: block.difficulty ?? 0,
                    minerAddress: block.minerAddress || ""
                }
            });

            // Lưu transactions
            for (const tx of block.transactions) {
                const txRecord = await prisma.transaction.create({
                    data: {
                        txId: tx.id,
                        blockId: blockRecord.id,
                        publicKey: tx.publicKey,
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
                            txIndex: txOut.txIndex,
                            transactionId: txRecord.id,
                            pendingTransactionId: null
                        }
                    });
                }

                // Lưu txIns
                for (const txIn of tx.txIns) {
                    await prisma.txIn.create({
                        data: {
                            txOutId: txIn.txOutId,
                            txOutIndex: txIn.txOutIndex,
                            signature: txIn.signature ?? null,
                            transactionId: txRecord.id,
                            pendingTransactionId: null
                        }
                    });
                }
            }
        } catch (err) {
            console.error("Failed to save block:", err);
        }
    }
}
