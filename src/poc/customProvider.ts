import Web3 from "web3";

export class SignerProvider extends Web3.providers.WebsocketProvider {
    private readonly signTransaction: any;

    constructor({host, signTransaction}) {
        super(host)
        this.signTransaction = signTransaction;
    }

    signAndSend(payload, nonce, gasPrice, callback) {
        const rawTxPayload = payload.params[0];
        rawTxPayload['nonce'] = nonce
        rawTxPayload['gasPrice'] = gasPrice

        // sign transaction with raw tx payload
        this.signTransaction(rawTxPayload, (keyError, signedHexPayload) => { // eslint-disable-line
            if (!keyError) {
                // create new output payload
                const outputPayload = {
                    id: payload.id,
                    jsonrpc: payload.jsonrpc,
                    method: 'eth_sendRawTransaction',
                    params: [signedHexPayload],
                };

                // send payload
                super.send(outputPayload, callback);
            } else {
                callback(new Error(`[SignerProvider] while signing your transaction payload: ${JSON.stringify(keyError)}`), undefined);
            }
        });
    }

    send(payload, callback) { // eslint-disable-line
        // console.log(payload)
        const self = this;
        if (payload.method === 'eth_sendTransaction') {
            // get the nonce, if any

            self.send({
                jsonrpc: '2.0',
                method: 'eth_getTransactionCount',
                // @ts-ignore
                params: [payload.params[0].from, 'latest'],
                id: (new Date()).getTime()
            }, (nonceError, nonce) => { // eslint-disable-line
                if (nonceError) {
                    return callback(new Error(`[SignerProvider] while getting nonce: ${nonceError}`), undefined);
                }
                // get the gas price, if any
                if (payload.params[0].gasPrice === undefined) {
                    self.send({jsonrpc: '2.0', method: 'eth_gasPrice', id: (new Date()).getTime()}, (gasPriceError, gasPrice) => { // eslint-disable-line
                        if (gasPriceError) {
                            return callback(new Error(`[SignerProvider] while getting gasPrice: ${gasPriceError}`), undefined);
                        }
                        self.signAndSend(payload, nonce.result, gasPrice.result, callback)
                    });
                }
                else self.signAndSend(payload, nonce.result, payload.params[0].gasPrice, callback)
            });
        } else {
            return super.send(payload, callback);
        }
    }
}
