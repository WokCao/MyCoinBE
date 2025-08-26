import express from "express";
import bodyParser from "body-parser";
import { Blockchain } from "./models/Blockchain";
import { getTransactionId, Transaction } from "./models/Transaction";
import cors from "cors";
import { PrismaClient } from "@prisma/client";
import { Block } from "./models/Block";
import { TxIn } from "./models/TxIn";
import { TxOut } from "./models/TxOut";
import { UnspentTxOut } from "./models/UnspentTxOut";
require("dotenv").config();

export const app = express();
const DEFAULT_ELEMENTS_PER_PAGE = 10;
app.use(
    cors({
        origin: "*",
        methods: "GET,POST,PUT,DELETE",
    })
);
app.use(bodyParser.json());

const prisma = new PrismaClient();

// INIT with mode option
const consensusMode = (process.env.MODE as "pow" | "pos") || "pow";
const blockchain = new Blockchain(consensusMode);

async function loadBlockchainFromDB() {
    // Load blocks with transactions
    const blocks = await prisma.block.findMany({
        orderBy: { index: "asc" },
        include: {
            transactions: {
                include: { txIns: true, txOuts: true }
            }
        }
    });

    if (blocks.length === 0) {
        console.log("No blocks found in DB, starting with genesis block");
        await blockchain.saveBlockToDB(blockchain.chain[0]);
    } else {
        blockchain.chain = blocks.map(b => {
            const blk = new Block(b.index, [], b.previousHash, b.difficulty || 3);
            blk.hash = b.hash;
            blk.nonce = b.nonce || 0;
            blk.timestamp = Number(b.timestamp);
            blk.minerAddress = b.minerAddress || "";

            blk.transactions = b.transactions.map(t => {
                const tx = new Transaction();
                tx.id = t.txId;
                tx.timestamp = Number(t.timestamp);
                tx.publicKey = t.publicKey || "";

                tx.txIns = t.txIns.map(i => {
                    const txIn = new TxIn();
                    txIn.txOutId = i.txOutId;
                    txIn.txOutIndex = i.txOutIndex;
                    txIn.signature = i.signature || "";
                    return txIn;
                });

                tx.txOuts = t.txOuts.map(o => {
                    const txOut = new TxOut(o.address, o.amount, o.txIndex);
                    return txOut;
                });

                return tx;
            });

            return blk;
        });
    }

    // Load pending transactions
    const pendingTxs = await prisma.pendingTransaction.findMany({
        include: { txIns: true, txOuts: true }
    });

    blockchain.pendingTransactions = pendingTxs.map(t => {
        const tx = new Transaction();
        tx.id = t.txId;
        tx.publicKey = t.publicKey || "";
        tx.timestamp = Number(t.timestamp);

        tx.txIns = t.txIns.map(i => {
            const txIn = new TxIn();
            txIn.txOutId = i.txOutId;
            txIn.txOutIndex = i.txOutIndex;
            txIn.signature = i.signature || "";
            return txIn;
        });

        tx.txOuts = t.txOuts.map(o => {
            const txOut = new TxOut(o.address, o.amount, o.txIndex);
            return txOut;
        });

        return tx;
    });

    blockchain.unspentTxOuts = [];

    for (const block of blockchain.chain) {
        for (const tx of block.transactions) {
            // Thêm tất cả TxOut của transaction vào unspent tạm thời
            tx.txOuts.forEach((txOut, index) => {
                blockchain.unspentTxOuts.push(
                    new UnspentTxOut(tx.id, index, txOut.address, txOut.amount)
                );
            });

            // Xoá các TxOut đã được sử dụng (trong txIns)
            tx.txIns.forEach(txIn => {
                blockchain.unspentTxOuts = blockchain.unspentTxOuts.filter(
                    uTxO => !(uTxO.txOutId === txIn.txOutId && uTxO.txOutIndex === txIn.txOutIndex)
                );
            });
        }
    }

    console.log(
        `Loaded ${blockchain.chain.length} blocks and ${blockchain.pendingTransactions.length} pending transactions`
    );
}

// Call load when server starts
loadBlockchainFromDB().then(() => {
    console.log("Blockchain restored from DB!");
});

// Get blockchain (with pagination)
app.get("/chain", (req, res) => {
    const { page } = req.query;
    const pageNum = page ? Number(page) : 1;
    const startIndex = (pageNum - 1) * DEFAULT_ELEMENTS_PER_PAGE;

    const sortedChain = blockchain.chain.sort((a, b) => b.timestamp - a.timestamp);
    const paginatedChain = sortedChain.slice(startIndex, startIndex + DEFAULT_ELEMENTS_PER_PAGE);

    res.json({
        blocks: paginatedChain,
        currentPage: pageNum,
        totalPages: Math.ceil(blockchain.chain.length / DEFAULT_ELEMENTS_PER_PAGE),
        totalBlocks: blockchain.chain.length
    });
});

// Get transactions
app.get("/transactions", (req, res) => {
    const { page } = req.query;
    const pageNum = page ? Number(page) : 1;
    const startIndex = (pageNum - 1) * DEFAULT_ELEMENTS_PER_PAGE;

    const allTransactions = blockchain.chain.flatMap(block => block.transactions);
    const sortedTransactions = allTransactions.sort((a, b) => b.timestamp - a.timestamp);
    const paginatedTransactions = sortedTransactions.slice(startIndex, startIndex + DEFAULT_ELEMENTS_PER_PAGE);

    res.json({
        transactions: paginatedTransactions,
        currentPage: pageNum,
        totalPages: Math.ceil(allTransactions.length / DEFAULT_ELEMENTS_PER_PAGE),
        totalTransactions: allTransactions.length
    });
});

// Get pending transactions
app.get("/pending", (_req, res) => {
    res.json(blockchain.pendingTransactions);
});

// Get unspent transaction outputs (all)
app.get("/unspent", (_req, res) => {
    res.json(blockchain.calculateTotalCoins());
});

// Get unspent transaction outputs (by address)
app.get("/unspent/:a", (req, res) => {
    const address = req.params.a;
    const uTxOs = blockchain.unspentTxOuts.filter(uTxO => uTxO.address === address);
    const spentInPending = blockchain.getSpentUTXOsInPending();
    const availableUTXOs = uTxOs.filter(utxo => {
        const key = `${utxo.txOutId}:${utxo.txOutIndex}`;
        return !spentInPending.has(key);
    });

    res.json(availableUTXOs);
})

app.get("/confirmedTransactions", (_req, res) => {
    res.json(blockchain.calculateConfirmedTransactions());
});

// Get free 50 coins from faucet
app.post("/faucet", async (req, res) => {
    const { address, amount, publicKey } = req.body;
    const txList: Transaction[] = [];
    for (let i = 0; i < 10; i++) {
        const tx = new Transaction();
        tx.publicKey = publicKey;
        tx.addTxOut(address, amount / 10 || 5);
        tx.addTxIn("", -1);

        tx.timestamp = Date.now() + i;;
        tx.id = getTransactionId(tx, true)

        // blockchain.pendingTransactions.push(tx);
        txList.push(tx);
    }

    const txIds = txList.map(tx => tx.id);
    await blockchain.mineSelectedByIds(txIds, address, true, txList);
    res.json({ msg: "Faucet added", txIds: txIds });
});

// Send coin to another address
app.post("/send", async (req, res) => {
    const tx: Transaction = req.body;

    try {
        blockchain.addTransaction(tx);
        res.json({ msg: "Transaction created", txId: tx.id });
    } catch (err: any) {
        console.error("Error creating transaction:", err);
        res.status(400).json({ error: err.message });
    }
});

// Mine selected transactions (PoW)
app.post("/mineSelected", async (req, res) => {
    const { minerAddress, txIds } = req.body;
    try {
        await blockchain.mineSelectedByIds(txIds, minerAddress);
        res.json({ msg: "Selected mined!" });
    } catch (err: any) {
        res.status(400).json({ error: err.message });
    }
});

// PoS stake
// app.post("/stake", (req, res) => {
//     const { address, amount } = req.body;
//     blockchain.stake(address, amount);
//     res.json({ msg: "Stake added" });
// });

// app.post("/pos/createBlock", async (_req, res) => {
//     try {
//         await blockchain.createBlockPoS();
//         res.json({ msg: "PoS block created" });
//     } catch (err: any) {
//         res.status(400).json({ error: err.message });
//     }
// });

// Get balance of an address
app.get("/address/:a/balance", (req, res) => {
    res.json({ balance: blockchain.getBalanceOfAddress(req.params.a) });
});
