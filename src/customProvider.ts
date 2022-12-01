import Web3 from "web3";
import * as path from 'path';
import dotenv from 'dotenv';
import * as process from "process";
import {calcGasPrice, error, log} from "./utils";
import {DECIMALS} from "./constants"
import Signer from "orbs-signer-client";

dotenv.config({path: path.resolve(__dirname, `../${process.env.ENV_FILE ?? '.env'}`)});

export class SignerProvider extends Web3.providers.WebsocketProvider {
    private readonly signTransaction: any;
    private signer: Signer;

    constructor({host, networkId}) {
        super(host)
        this.signer = new Signer(process.env.SIGNER_URL!);
        this.signTransaction = async (txData) => {
            try {
                // txData.gasLimit = txData.gas
                const result = await this.signer.sign(txData, networkId);
                return result.rawTransaction;
            } catch (e) {
                // @ts-ignore
                error(e.message)
            }
        }
    }

    async signAndSend(payload, nonce, gasPrice, gasLimit, callback) {
        const rawTxPayload = payload.params[0];
        rawTxPayload['nonce'] = nonce;
        rawTxPayload['gasPrice'] = gasPrice;
        rawTxPayload['gasLimit'] = gasLimit;
        log(`Sending tx ${JSON.stringify(rawTxPayload)}`)

        // sign transaction with raw tx payload
        const signedHexPayload = await this.signTransaction(rawTxPayload);
        // create new output payload
        const outputPayload = {
            id: payload.id,
            jsonrpc: payload.jsonrpc,
            method: 'eth_sendRawTransaction',
            params: [signedHexPayload],
        };
        super.send(outputPayload, callback);
    }

    send(payload, callback) {
        const self = this;
        if (payload.method === 'eth_sendTransaction') {
            const gas = payload.params[0].gas;
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
                        calcGasPrice(parseInt(chainId.result), baseFeeGwei, payload.params[0].urgencyInSeconds, payload.params[0].maxGasPrice).then(gasPrice => {
                            if (gasPrice) {
                                log(`Sending tx with calculated gasPrice: ${parseInt(gasPrice) / DECIMALS} gwei`);
                            }
                            else { // api error or low maxGasPrice
                                gasPrice = baseFee;
                                log(`Sending tx with base fee: ${parseInt(baseFee) / DECIMALS} gwei`);
                            }
                            self.send({
                                jsonrpc: '2.0',
                                method: 'eth_estimateGas',
                                params: [payload.params[0]],
                                id: (new Date()).getTime()
                            }, (estimateGasError, estimateGas) => {
                                if (estimateGasError) {
                                    error(`[SignerProvider] failed to estimate gas limit`); // TODO: fallback to default amount?
                                }
                                else {
                                    const gasLimit = gas ?? estimateGas.result;
                                    self.signAndSend(payload, nonce.result, gasPrice, gasLimit, callback);
                                }
                            })
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
