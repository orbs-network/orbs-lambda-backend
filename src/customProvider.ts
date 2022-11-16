import Web3 from "web3";
import fetch from "node-fetch";
import * as path from 'path';
import dotenv from 'dotenv';
import * as process from "process";
import {log, error} from "./utils";
import {DECIMALS} from "./constants"

dotenv.config({path: path.resolve(__dirname, `../${process.env.ENV_FILE ?? '.env'}`)});

export class SignerProvider extends Web3.providers.WebsocketProvider {
    private readonly signTransaction: any;

    constructor({host, signTransaction}) {
        super(host)
        this.signTransaction = signTransaction;
    }

    async calcGasPrice(chainId, baseFee, urgencyInSeconds, maxGasPrice) {
        if (maxGasPrice && maxGasPrice > baseFee) {
            const res = await fetch(`https://api.owlracle.info/v3/${chainId}/gas?eip1559=false&accept=10,15,20,25,30,35,40,45,50,55,60,65,70,75,80,85,90,95,100&apikey=${process.env.OWLRACLE_APIKEY}`);
            if (res.status === 200) {
                const data = await res.json();
                let acceptance = urgencyInSeconds ? 1 - Math.pow(0.01, data.avgTime / urgencyInSeconds) : 0.75 // acceptance within the desired time with 99% probability. (https://www.statology.org/probability-of-at-least-two). default is 0.75
                const price = data.speeds.find(speed => {
                    if (speed.acceptance >= acceptance) return speed.gasPrice
                }).gasPrice
                const maxPrice = maxGasPrice ? Math.min(price, maxGasPrice) : price;
                return Web3.utils.toHex(Web3.utils.toWei(maxPrice.toString(), 'gwei'));
            } else error(`Owlracle request failed with status code ${res.status}`);
        } else log(`maxGasPrice ${maxGasPrice} < base fee ${baseFee}`)
    }

    signAndSend(payload, nonce, gasPrice, callback) {
        const rawTxPayload = payload.params[0];
        rawTxPayload['nonce'] = nonce
        rawTxPayload['gasPrice'] = gasPrice
        log(`Sending tx ${JSON.stringify(rawTxPayload)}`)

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
                super.send(outputPayload, callback);
            } else {
                callback(new Error(`[SignerProvider] while signing your transaction payload: ${JSON.stringify(keyError)}`), undefined);
            }
        });
    }

    send(payload, callback) {
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
                self.send({
                    jsonrpc: '2.0',
                    method: 'eth_chainId',
                    id: (new Date()).getTime()
                }, (chainIdError, chainId) => {
                    if (chainIdError) {
                        return callback(new Error(`[SignerProvider] while getting chainId: ${chainIdError}`), undefined);
                    }
                    self.send({
                        jsonrpc: '2.0',
                        method: 'eth_feeHistory',
                        params: [1, "pending", [0.75]],
                        id: (new Date()).getTime()
                    }, (feeHistoryError, feeHistory) => {
                        if (feeHistoryError) {
                            return callback(new Error(`[SignerProvider] while getting feeHistory: ${feeHistoryError}`), undefined);
                        }
                        const baseFee = feeHistory.result.baseFeePerGas.pop();
                        const baseFeeGwei = Number(baseFee/DECIMALS);
                        this.calcGasPrice(parseInt(chainId.result), baseFeeGwei, payload.params[0].urgencyInSeconds, payload.params[0].maxGasPrice).then(gasPrice => {
                            if (gasPrice) {
                                log(`Sending tx with calculated gasPrice: ${parseInt(gasPrice) / DECIMALS} gwei`);
                            }
                            else { // api error or low maxGasPrice
                                gasPrice = baseFee;
                                log(`Sending tx with base fee: ${parseInt(baseFee) / DECIMALS} gwei`);
                            }
                            self.signAndSend(payload, nonce.result, gasPrice, callback);
                        }).catch(e => {
                            console.error(e)});
                    });
                });
            });
        } else {
            return super.send(payload, callback);
        }
    }
}
