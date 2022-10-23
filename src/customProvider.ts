import Web3 from "web3";
import fetch from "node-fetch";
import * as path from 'path';
import dotenv from 'dotenv';
import * as process from "process";

dotenv.config({path: path.resolve(__dirname, '../.env')});

const OWLRACLE_MAPPING = {
    1: 'eth',
    137: 'poly',
    56: 'bsc',
    250: 'ftm',
    43114: 'avax'
}

export class SignerProvider extends Web3.providers.WebsocketProvider {
    private readonly signTransaction: any;

    constructor({host, signTransaction}) {
        super(host)
        this.signTransaction = signTransaction;
    }

    async calcGasPrice(chainId, urgencyInSeconds, maxGasPrice) {
        const res = await fetch(`https://api.owlracle.info/v3/${OWLRACLE_MAPPING[chainId]}/gas?eip1559=false&accept=10,15,20,25,30,35,40,45,50,55,60,65,70,75,80,85,90,95,100&apikey=${process.env.OWLRACLE_APIKEY}`);
        const data = await res.json();
        let acceptance = urgencyInSeconds ? 1 - Math.pow(0.01, data.avgTime/urgencyInSeconds) : 0.75 // acceptance within the desired time with 99% probability. (https://www.statology.org/probability-of-at-least-two). default is 0.75
        const price = data.speeds.find(speed => {if (speed.acceptance >= acceptance) return speed.gasPrice}).gasPrice
        const maxPrice = maxGasPrice ? Math.min(price, maxGasPrice) : price;
        return Web3.utils.toHex(Web3.utils.toWei(maxPrice.toString(), 'gwei'));
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
                    self.send({jsonrpc: '2.0', method: 'eth_chainId', id: (new Date()).getTime()}, (chainIdError, chainId) => { // eslint-disable-line
                        if (chainIdError) {
                            return callback(new Error(`[SignerProvider] while getting chainId: ${chainIdError}`), undefined);
                        }
                        this.calcGasPrice(parseInt(chainId.result), payload.params[0].urgencyInSeconds, payload.params[0].maxGasPrice).then(gasPrice => {self.signAndSend(payload, nonce.result, gasPrice, callback)})
                    });
                }
                else self.signAndSend(payload, nonce.result, payload.params[0].gasPrice, callback)
            });
        } else {
            return super.send(payload, callback);
        }
    }
}