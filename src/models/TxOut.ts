export class TxOut {
    address: string = "";
    amount: number = 0;
    txIndex: number = 0;

    constructor(address: string, amount: number, txIndex: number) {
        this.address = address;
        this.amount = amount;
        this.txIndex = txIndex;
    }
}