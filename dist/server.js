"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.app = void 0;
const express_1 = __importDefault(require("express"));
const body_parser_1 = __importDefault(require("body-parser"));
const Blockchain_1 = require("./models/Blockchain");
const Transaction_1 = require("./models/Transaction");
const cors_1 = __importDefault(require("cors"));
const client_1 = require("@prisma/client");
const Block_1 = require("./models/Block");
require("dotenv").config();
exports.app = (0, express_1.default)();
exports.app.use((0, cors_1.default)({
    origin: "*",
    methods: "GET,POST,PUT,DELETE",
}));
exports.app.use(body_parser_1.default.json());
const prisma = new client_1.PrismaClient();
// INIT with mode option
const consensusMode = process.env.MODE || "pow";
const blockchain = new Blockchain_1.Blockchain(consensusMode);
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
    }
    else {
        blockchain.chain = blocks.map(b => {
            const blk = new Block_1.Block(b.index, [], b.previousHash, b.difficulty || 3);
            blk.hash = b.hash;
            blk.nonce = b.nonce || 0;
            blk.timestamp = Number(b.timestamp);
            blk.transactions = b.transactions.map(t => {
                const tx = new Transaction_1.Transaction();
                tx.id = t.txId;
                tx.timestamp = Number(t.timestamp);
                tx.txIns = t.txIns.map(i => {
                    const txIn = new Transaction_1.TxIn();
                    txIn.txOutId = i.txOutId;
                    txIn.txOutIndex = i.txOutIndex;
                    txIn.signature = i.signature || "";
                    return txIn;
                });
                tx.txOuts = t.txOuts.map(o => {
                    const txOut = new Transaction_1.TxOut(o.address, o.amount);
                    return txOut;
                });
                return tx;
            });
            return blk;
        });
    }
    // Load pending transactions (blockId == null)
    const pendingTxs = await prisma.transaction.findMany({
        where: { blockId: null },
        include: { txIns: true, txOuts: true }
    });
    blockchain.pendingTransactions = pendingTxs.map(t => {
        const tx = new Transaction_1.Transaction();
        tx.id = t.txId;
        tx.timestamp = Number(t.timestamp);
        tx.txIns = t.txIns.map(i => {
            const txIn = new Transaction_1.TxIn();
            txIn.txOutId = i.txOutId;
            txIn.txOutIndex = i.txOutIndex;
            txIn.signature = i.signature || "";
            return txIn;
        });
        tx.txOuts = t.txOuts.map(o => {
            const txOut = new Transaction_1.TxOut(o.address, o.amount);
            return txOut;
        });
        return tx;
    });
    blockchain.unspentTxOuts = [];
    for (const block of blockchain.chain) {
        for (const tx of block.transactions) {
            // Thêm tất cả TxOut của transaction vào unspent tạm thời
            tx.txOuts.forEach((txOut, index) => {
                blockchain.unspentTxOuts.push(new Transaction_1.UnspentTxOut(tx.id, index, txOut.address, txOut.amount));
            });
            // Xoá các TxOut đã được sử dụng (trong txIns)
            tx.txIns.forEach(txIn => {
                blockchain.unspentTxOuts = blockchain.unspentTxOuts.filter(uTxO => !(uTxO.txOutId === txIn.txOutId && uTxO.txOutIndex === txIn.txOutIndex));
            });
        }
    }
    console.log(`Loaded ${blockchain.chain.length} blocks and ${blockchain.pendingTransactions.length} pending transactions`);
}
async function sendCoin(fromAddress, toAddress, amount, privateKey) {
    // 1. Lấy UTXO hiện có
    const aUnspentTxOuts = blockchain.chain.flatMap(block => block.transactions.flatMap(tx => tx.txOuts.map((txOut, index) => {
        return new Transaction_1.UnspentTxOut(tx.id, index, txOut.address, txOut.amount);
    })));
    const myUTXOs = aUnspentTxOuts.filter(uTxO => uTxO.address === fromAddress);
    const selectedUTXOs = [];
    let accumulated = 0;
    for (const utxo of myUTXOs) {
        selectedUTXOs.push(utxo);
        accumulated += utxo.amount;
        if (accumulated >= amount)
            break;
    }
    if (accumulated < amount) {
        throw new Error("Not enough balance");
    }
    // 2. Tạo transaction
    const tx = new Transaction_1.Transaction();
    // Tạo TxIn từ UTXO
    tx.txIns = selectedUTXOs.map(uTxO => {
        const txIn = new Transaction_1.TxIn();
        txIn.txOutId = uTxO.txOutId;
        txIn.txOutIndex = uTxO.txOutIndex;
        txIn.signature = '';
        return txIn;
    });
    // Tạo TxOut cho người nhận
    tx.txOuts.push(new Transaction_1.TxOut(toAddress, amount));
    // Nếu dư tiền, trả về địa chỉ gửi
    const change = accumulated - amount;
    if (change > 0) {
        tx.txOuts.push(new Transaction_1.TxOut(fromAddress, change));
    }
    // Ký từng TxIn
    tx.txIns.forEach((txIn, index) => {
        txIn.signature = (0, Transaction_1.signTxIn)(tx, index, privateKey, aUnspentTxOuts);
    });
    // Tạo id transaction
    tx.id = (0, Transaction_1.getTransactionId)(tx);
    console.log(`Transaction created: ${tx.id}`);
    blockchain.addTransaction(tx);
    console.log('Passed');
    return tx;
}
// Call load when server starts
loadBlockchainFromDB().then(() => {
    console.log("Blockchain restored from DB!");
});
// Get blockchain
exports.app.get("/chain", (_req, res) => {
    res.json(blockchain.chain);
});
// Get pending transactions
exports.app.get("/pending", (_req, res) => {
    res.json(blockchain.pendingTransactions);
});
// Add transaction
exports.app.post("/tx", (req, res) => {
    try {
        const { txIns, txOuts } = req.body;
        const tx = new Transaction_1.Transaction();
        tx.txIns = txIns.map((i) => {
            const txIn = new Transaction_1.TxIn();
            txIn.txOutId = i.txOutId;
            txIn.txOutIndex = i.txOutIndex;
            txIn.signature = i.signature || "";
            return txIn;
        });
        tx.txOuts = txOuts.map((o) => new Transaction_1.TxOut(o.address, o.amount));
        // Tạo id cho transaction
        tx.id = blockchain.pendingTransactions.length
            ? (Number(blockchain.pendingTransactions[blockchain.pendingTransactions.length - 1].id) + 1).toString()
            : "1";
        blockchain.addTransaction(tx);
        res.json({ msg: "Transaction queued", txId: tx.id });
    }
    catch (err) {
        res.status(400).json({ error: err.message });
    }
});
// Faucet
exports.app.post("/faucet", async (req, res) => {
    const { address, amount } = req.body;
    const tx = new Transaction_1.Transaction();
    tx.txOuts = [new Transaction_1.TxOut(address, amount || 50)];
    tx.id = blockchain.pendingTransactions.length
        ? (Number(blockchain.pendingTransactions[blockchain.pendingTransactions.length - 1].id) + 1).toString()
        : "1";
    blockchain.pendingTransactions.push(tx);
    await blockchain.mineSelectedByIds([tx.id], address, true);
    res.json({ msg: "Faucet added", txId: tx.id });
});
// Send coin
exports.app.post("/send", async (req, res) => {
    const { fromAddress, toAddress, amount, privateKey } = req.body;
    try {
        const tx = await sendCoin(fromAddress, toAddress, amount, privateKey);
        res.json({ msg: "Transaction created", txId: tx.id });
    }
    catch (err) {
        console.error("Error creating transaction:", err);
        res.status(400).json({ error: err.message });
    }
});
// Mine selected transactions (PoW)
exports.app.post("/mineSelected", async (req, res) => {
    const { minerAddress, txIds } = req.body;
    try {
        await blockchain.mineSelectedByIds(txIds, minerAddress);
        res.json({ msg: "Selected mined!" });
    }
    catch (err) {
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
exports.app.get("/address/:a/balance", (req, res) => {
    res.json({ balance: blockchain.getBalanceOfAddress(req.params.a) });
});
