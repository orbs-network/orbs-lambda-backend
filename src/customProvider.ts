import Web3 from "web3";

export class CustomProvider extends Web3.providers.WebsocketProvider {
    constructor(rpcUrl) {
        super(rpcUrl)
    }

    // Overriding low-level 'send' in order to prevent gas price injection by web3-core-method._handleTxPricing
    send(payload, callback) {
        const targetObject = {};
        Error.captureStackTrace(targetObject);
        // @ts-ignore
        if (payload.method === 'eth_getBlockByNumber' && targetObject.stack.includes("_handleTxPricing")) {
            return callback(null, {"jsonrpc": "2.0", "id": payload.id, "result": {}})
        }
        return super.send(payload, callback);
    }
}
