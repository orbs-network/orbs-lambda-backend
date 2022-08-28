import HookedWeb3Provider from "hooked-web3-provider"
import Web3 from "web3"

const provider = new HookedWeb3Provider({
    host: "https://polygon-mainnet.g.alchemy.com/v2/ycYturL7FncO-c6xtUDKApfIFnorZToh",
    transaction_signer: {
        // Can be any object that implements the following methods:
        hasAddress: function(address, callback) {
            callback(null, true)},
        signTransaction: function(tx_params, callback) {
            console.log(tx_params)}
    }
});

