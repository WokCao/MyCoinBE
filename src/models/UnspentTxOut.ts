export class UnspentTxOut {
    readonly txOutId: string;
    readonly txOutIndex: number;
    readonly address: string;
    readonly amount: number;

    constructor(txOutId: string, txOutIndex: number, address: string, amount: number) {
        this.txOutId = txOutId;
        this.txOutIndex = txOutIndex;
        this.address = address;
        this.amount = amount;
    }
}