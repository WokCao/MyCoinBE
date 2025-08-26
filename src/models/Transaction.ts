import * as CryptoJS from "crypto-js";
import * as elliptic from "elliptic";
import { TxIn } from "./TxIn";
import { TxOut } from "./TxOut";
import { UnspentTxOut } from "./UnspentTxOut";

const ec = new elliptic.ec("secp256k1");

export class Transaction {
    id: string = "";
    txIns: TxIn[] = [];
    txOuts: TxOut[] = [];
    publicKey: string = "";
    timestamp: number = Date.now();

    addTxOut(address: string, amount: number): TxOut {
        const txIndex = this.txOuts.length;
        const txOut = new TxOut(address, amount, txIndex);
        this.txOuts.push(txOut);
        return txOut;
    }

    addTxIn(txOutId: string, txOutIndex: number, signature: string = ""): TxIn {
        const txIn = new TxIn();
        txIn.txOutId = txOutId;
        txIn.txOutIndex = txOutIndex;
        txIn.signature = signature;
        this.txIns.push(txIn);
        return txIn;
    }
}

// Tạo transactionId bằng cách hash các TxIn, TxOut và timestamp
export const getTransactionId = (transaction: Transaction, isTest: boolean = false): string => {
    const txInContent = transaction.txIns
        .map(txIn => txIn.txOutId + txIn.txOutIndex + txIn.signature)
        .join("");

    const txOutContent = transaction.txOuts
        .map(txOut => txOut.address + txOut.amount)
        .join("");

    if (isTest) {
        return CryptoJS.SHA256(txInContent + txOutContent + transaction.timestamp).toString();
    } else {
        return CryptoJS.SHA256(txInContent + txOutContent).toString();
    }

};

export const createCoinbaseTx = (address: string, amount: number): Transaction => {
    const t = new Transaction();

    t.addTxIn("", -1);
    t.addTxOut(address, amount);

    t.id = getTransactionId(t);
    return t;
};

// Validate transaction cơ bản
export const isValidTransaction = (tx: Transaction, aUnspentTxOuts: UnspentTxOut[]): boolean => {
    if (getTransactionId(tx) !== tx.id) {
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

export const getAddressFromPublicKey = (publicKey: string): string => {
    // SHA256 hash của public key
    const sha256Hash = CryptoJS.SHA256(publicKey).toString();
    return sha256Hash.slice(-40)
};

const validateTxIn = (txIn: TxIn, transaction: Transaction, aUnspentTxOuts: UnspentTxOut[]): boolean => {
    const referencedUTxO = findUnspentTxOut(txIn.txOutId, txIn.txOutIndex, aUnspentTxOuts);

    if (referencedUTxO == null) {
        console.log("Referenced txOut not found");
        return false;
    }

    const key = ec.keyFromPublic(transaction.publicKey, "hex");
    const addressFromKey = getAddressFromPublicKey(transaction.publicKey);

    if (addressFromKey !== referencedUTxO.address) {
        console.log("Public key does not match UTXO owner");
        return false;
    }

    const toAddress = transaction.txOuts[0].address;
    const coinToTransfer = transaction.txOuts[0].amount;
    const msgHash = `${txIn.txOutId}:${txIn.txOutIndex}:${toAddress}:${coinToTransfer}`;

    return key.verify(msgHash, txIn.signature);
};

// Tìm UTXO tham chiếu trong danh sách unspentTxOuts
export const findUnspentTxOut = (
    transactionId: string,
    index: number,
    unspentTxOuts: UnspentTxOut[]
): UnspentTxOut | undefined => {
    return unspentTxOuts.find(
        (uTxO: UnspentTxOut) => uTxO.txOutId === transactionId && uTxO.txOutIndex === index
    );
};