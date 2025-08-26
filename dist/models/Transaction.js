"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.signTxIn = exports.toHexString = exports.getAddressFromPublicKey = exports.getPublicKey = exports.findUnspentTxOut = exports.isValidTransaction = exports.createCoinbaseTx = exports.getTransactionId = exports.Transaction = exports.UnspentTxOut = exports.TxOut = exports.TxIn = void 0;
const CryptoJS = __importStar(require("crypto-js"));
const elliptic = __importStar(require("elliptic"));
const ec = new elliptic.ec("secp256k1");
class TxIn {
    constructor() {
        this.txOutId = "";
        this.txOutIndex = 0;
        this.signature = "";
    }
}
exports.TxIn = TxIn;
class TxOut {
    constructor(address, amount) {
        this.address = "";
        this.amount = 0;
        this.address = address;
        this.amount = amount;
    }
}
exports.TxOut = TxOut;
class UnspentTxOut {
    constructor(txOutId, txOutIndex, address, amount) {
        this.txOutId = txOutId;
        this.txOutIndex = txOutIndex;
        this.address = address;
        this.amount = amount;
    }
}
exports.UnspentTxOut = UnspentTxOut;
class Transaction {
    constructor() {
        this.id = "";
        this.txIns = [];
        this.txOuts = [];
        this.timestamp = Date.now();
    }
}
exports.Transaction = Transaction;
// Tạo transactionId bằng cách hash các TxIn và TxOut
const getTransactionId = (transaction) => {
    const txInContent = transaction.txIns
        .map((txIn) => txIn.txOutId + txIn.txOutIndex)
        .reduce((a, b) => a + b, "");
    const txOutContent = transaction.txOuts
        .map((txOut) => txOut.address + txOut.amount)
        .reduce((a, b) => a + b, "");
    return CryptoJS.SHA256(txInContent + txOutContent).toString();
};
exports.getTransactionId = getTransactionId;
const createCoinbaseTx = (address, amount) => {
    const t = new Transaction();
    const txIn = new TxIn();
    txIn.txOutId = ""; // coinbase: không tham chiếu UTXO nào
    txIn.txOutIndex = -1;
    t.txIns = [txIn];
    const txOut = new TxOut(address, amount);
    t.txOuts = [txOut];
    t.id = (0, exports.getTransactionId)(t);
    return t;
};
exports.createCoinbaseTx = createCoinbaseTx;
// Validate transaction cơ bản
const isValidTransaction = (tx, aUnspentTxOuts) => {
    if ((0, exports.getTransactionId)(tx) !== tx.id) {
        console.log("Invalid tx id");
        return false;
    }
    for (const txIn of tx.txIns) {
        if (!validateTxIn(txIn, tx, aUnspentTxOuts)) {
            console.log("Invalid txIn");
            return false;
        }
    }
    return true;
};
exports.isValidTransaction = isValidTransaction;
const validateTxIn = (txIn, transaction, aUnspentTxOuts) => {
    const referencedUTxO = (0, exports.findUnspentTxOut)(txIn.txOutId, txIn.txOutIndex, aUnspentTxOuts);
    if (referencedUTxO == null) {
        console.log("Referenced txOut not found");
        return false;
    }
    const address = referencedUTxO.address;
    const key = ec.keyFromPublic(address, "hex");
    return key.verify(transaction.id, txIn.signature);
};
// Tìm UTXO tham chiếu trong danh sách unspentTxOuts
const findUnspentTxOut = (transactionId, index, unspentTxOuts) => {
    return unspentTxOuts.find((uTxO) => uTxO.txOutId === transactionId && uTxO.txOutIndex === index);
};
exports.findUnspentTxOut = findUnspentTxOut;
// Lấy publicKey từ privateKey
const getPublicKey = (privateKey) => {
    return ec.keyFromPrivate(privateKey, "hex").getPublic().encode("hex", false);
};
exports.getPublicKey = getPublicKey;
const getAddressFromPublicKey = (publicKey) => {
    // SHA256 hash của public key
    const sha256Hash = CryptoJS.SHA256(publicKey).toString();
    return sha256Hash.slice(-40);
};
exports.getAddressFromPublicKey = getAddressFromPublicKey;
// Chuyển chữ ký thành chuỗi hex
const toHexString = (byteArray) => {
    return Array.from(byteArray, (byte) => {
        return ("0" + (byte & 0xff).toString(16)).slice(-2);
    }).join("");
};
exports.toHexString = toHexString;
// Hàm ký TxIn
const signTxIn = (transaction, txInIndex, privateKey, aUnspentTxOuts) => {
    const txIn = transaction.txIns[txInIndex];
    const referencedUnspentTxOut = (0, exports.findUnspentTxOut)(txIn.txOutId, txIn.txOutIndex, aUnspentTxOuts);
    if (referencedUnspentTxOut == null) {
        throw new Error("Could not find referenced txOut");
    }
    // Lấy public key và địa chỉ từ private key
    const publicKey = (0, exports.getPublicKey)(privateKey);
    const derivedAddress = (0, exports.getAddressFromPublicKey)(publicKey);
    const referencedAddress = referencedUnspentTxOut.address;
    console.log("Private key:", privateKey);
    console.log("Public key:", publicKey);
    console.log("Derived address:", derivedAddress);
    console.log("Referenced address:", referencedAddress);
    // SỬA: So sánh ĐỊA CHỈ với ĐỊA CHỈ
    if (derivedAddress !== referencedAddress) {
        throw new Error("Private key does not own the referenced UTXO");
    }
    // Tạo bản copy không có chữ ký để ký
    const txCopy = Object.assign({}, transaction);
    txCopy.txIns = txCopy.txIns.map(input => (Object.assign(Object.assign({}, input), { signature: "" })));
    // Lấy dữ liệu để ký (hash của transaction không chữ ký)
    const dataToSign = (0, exports.getTransactionId)(txCopy);
    // Ký dữ liệu
    const key = ec.keyFromPrivate(privateKey, "hex");
    const signature = (0, exports.toHexString)(key.sign(dataToSign).toDER());
    console.log("Signature generated:", signature);
    return signature;
};
exports.signTxIn = signTxIn;
