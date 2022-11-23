import {account, erc20s} from "@defi.org/web3-candies";
import {expect} from "chai";
import {useChaiBigNumber} from "@defi.org/web3-candies/dist/hardhat";
import {Engine} from "../../src/engine";
import {guardians} from "../fixtures";
import {MS_TO_MINUTES, TASK_TIME_DIVISION_MIN} from "../../src/constants";
import {set} from 'mockdate';

useChaiBigNumber()

describe("Test handlers", () => {
    const instance = new Engine({'ethereum': {"id": 1, "rpcUrl": "https://fake.url"}}, guardians, '')
    instance.loadModules({test: "/Users/idanatar/sources/orbs-lambda-backend/test/e2e/index.js"});

    it("onInterval", async () => {
        set(TASK_TIME_DIVISION_MIN*MS_TO_MINUTES*Object.keys(guardians).length);
        await instance._onInterval()
        const dai = erc20s.eth.DAI();
        const owner = await account();
        expect(await dai.methods.allowance(owner, owner).call()).bignumber.eq(1);
        expect(instance.runningTasks).to.equal(0);
    });
    it("onCron", async () => {
        const lambda = instance.lambdas['test'][1]
        await instance._onCron(lambda)
        const wbtc = erc20s.eth.WBTC();
        const owner = await account();
        expect(await wbtc.methods.allowance(owner, owner).call()).bignumber.eq(1);
        expect(instance.runningTasks).to.equal(0);
    });
    it("onEvent", async () => {
        const lambda = instance.lambdas['test'][2]
        await instance._onEvent({transactionHash: "0x09c3be8189eb5bdd9ab559dcddb3ae09d2b394a5e96fef3566a3232e088fa3"}, lambda)
        const weth = erc20s.eth.WETH();
        const owner = await account();
        expect(await weth.methods.allowance(owner, owner).call()).bignumber.eq(1);
        expect(instance.runningTasks).to.equal(0);
    });

})