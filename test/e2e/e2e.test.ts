import chaiAsPromised from 'chai-as-promised';
import chai from "chai";

import {useChaiBigNumber} from "@defi.org/web3-candies/dist/hardhat";
import {Engine} from "../../src/engine";
import {abi, guardians} from "../fixtures";
import {stub} from "sinon"
import * as CustomProviderClass from "../../src/customProvider"
import Web3 from "web3";

useChaiBigNumber()
chai.use(chaiAsPromised);
const expect = chai.expect;

describe("Test custom web3", async () => {
    class MockCustomProvider extends Web3.providers.WebsocketProvider {
        constructor(rpcUrl) {
            super(rpcUrl)
        }

        send(payload, callback) {
            const targetObject = {};
            Error.captureStackTrace(targetObject);
            if (payload.method === 'eth_getBlockByNumber' && targetObject.stack.includes("_handleTxPricing")) {
                return callback(null, {"jsonrpc": "2.0", "id": payload.id, "result": {}})
            }
            if (payload.method === 'eth_sendRawTransaction')
                return callback(null, {"jsonrpc": "2.0", "id": payload.id, "result": {}})
            if (payload.method === 'eth_getTransactionReceipt')
                // payload.params[0] = "0x0a83ce72549badcaa91e16ef4d270833bb6444ea7db8ffe102f56f8a07cbf612" // goerli
                payload.params[0] = "0xb73891cea3f393096f998ffaec295a03a4c78fe9bd4e8b4dc3192527bf0da5d7" // polygon
            return super.send(payload, callback);
        }
    }

    stub(CustomProviderClass, "CustomProvider").callsFake((args) => {return new MockCustomProvider(args)});
    const engine = new Engine({
        'goerli': {"id": 5, "rpcUrl": process.env.GOERLI_PROVIDER},
        "polygon": {id: 137, rpcUrl: process.env.POLYGON_PROVIDER}
    }, guardians);
    const web3 = await engine.initWeb3('polygon');

    it("gfdgdf", ()=> {
        expect(1).to.equal(1)
    })
    it("sends tx with gas limit", async () => {
        await web3.eth.sendTransaction({
            gas: 21000,
            to: '0x216FF847E6e1cf55618FAf443874450f734885e0',
            value: 0,
        })
    })

    it("sends tx without gas limit", async () => {
        await web3.eth.sendTransaction({
            to: '0x216FF847E6e1cf55618FAf443874450f734885e0',
            value: 0,
        })
    })

    it("sends eip-1559 tx with all gas types supplied", async () => {
        await web3.eth.sendTransaction({
            gas: 21000,
            gasPrice: 50e19,
            maxFeePerGas: 50e19,
            maxPriorityFeePerGas: 3e19,
            to: '0x216FF847E6e1cf55618FAf443874450f734885e0',
            value: 0,
            type: 2
        })
    })

    it("doesn't send eip-1559 tx with only legacy gas supplied", async () => {
        expect(web3.eth.sendTransaction({
            gas: 21000,
            gasPrice: 50e19,
            maxPriorityFeePerGas: 50e19,
            maxFeePerGas: 3e19,
            to: '0x216FF847E6e1cf55618FAf443874450f734885e0',
            value: 0,
            type: 2
        })).to.eventually.be.rejected;
    })

    it("doesn't send legacy tx with eip-1559 gas supplied", async () => {
        expect(web3.eth.sendTransaction({
            gas: 21000,
            gasPrice: 50e19,
            maxFeePerGas: 50e19,
            maxPriorityFeePerGas: 3e19,
            to: '0x216FF847E6e1cf55618FAf443874450f734885e0',
            value: 0,
            type: 0
        })).to.eventually.be.rejected;
    })

    it("sends tx with gas", async () => {
        await web3.eth.sendTransaction({
            gas: 21000,
            to: '0x216FF847E6e1cf55618FAf443874450f734885e0',
            value: 0,
        })
    })

    it("sends contract call with params", async () => {
        const contract = new web3.eth.Contract(abi, "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45")
        await contract.methods.refundETH().send({
            gas: 22000,
            maxFeePerGas: 50e19,
            maxPriorityFeePerGas: 50e19
        })
    });

    it("sends contract call with no params", async () => {
        const contract = new web3.eth.Contract(abi, "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45")
        await contract.methods.refundETH().send()
    });
});