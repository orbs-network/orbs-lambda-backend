import {expect} from "chai";
import {beforeEach} from "mocha";
import {Engine} from "../../src/engine";
import {guardians} from "../fixtures";
import {set} from 'mockdate'
import {MS_TO_MINUTES, TASK_TIME_DIVISION_MIN} from "../../src/constants";
import {intervalToMinutes, validateCron, getMatchingFiles, getCommittee, calcGasPrice, error} from "../../src/utils";
import {SOURCE_API, SOURCE_FEE_HISTORY} from "../../src/constants";
import {useChaiBigNumber} from "@defi.org/web3-candies/dist/hardhat";

useChaiBigNumber()


describe("Utils", () => {
    it("Should return a task list", () => {
        expect(getMatchingFiles(`${process.cwd()}/test/unit/`, "index.js")).to.not.be.empty;
    })
    it("Should have exactly 1 guardian as current node", async () => {
        const committee = await getCommittee("http://54.95.108.148/services/management-service/status");
        // @ts-ignore
        const current = Object.values(committee).filter(x => x.currentNode)
        expect(current).to.have.lengthOf(1);
    })
    it("Should return valid expression (len 5)", () => {
        const pattern = "* * * * *";
        expect(validateCron(pattern)).to.equal(pattern);
    });
    it("Should return valid expression (len 6)", () => {
        const pattern = "* * * * * *";
        expect(validateCron(pattern)).to.equal("* * * * *");
    });
    it("Should throw error", () => {
        const pattern = "* * * *";
        expect(() => validateCron(pattern)).to.throw();
    });
    it("Should throw invalid expression", () => {
        const pattern = "* * * * x";
        expect(() => validateCron(pattern)).to.throw();
    });
    it("Should throw invalid interval", () => {
        const pattern = "1x";
        expect(() => intervalToMinutes(pattern)).to.throw();
    });
    it("Should have api source", async () => {
        const result = await calcGasPrice(1, {"oldestBlock": "0x7bd95f", "reward": [["0x59a"]],"baseFeePerGas": ["0x211ce","0x1d9ca"],"gasUsedRatio": [0.0770745]}, 2);
        expect(result).to.include.all.keys("maxPriorityFeePerGas", "maxFeePerGas", "source");
        expect(result.source).to.equal(SOURCE_API);
    });
    // it("Should have feeHistory source", async () => {
    //     process.env["OWLRACLE_APIKEY"] = 'blabla'
    //     const result = await calcGasPrice(1, {"oldestBlock": "0x7bd95f", "reward": [["0x59a"]],"baseFeePerGas": ["0x211ce","0x1d9ca"],"gasUsedRatio": [0.0770745]}, 2);
    //     expect(result).to.include.all.keys("maxPriorityFeePerGas", "maxFeePerGas", "source");
    //     expect(result.source).to.equal(SOURCE_FEE_HISTORY);
    // });

})

describe("Engine", () => {
    let engine: Engine;
    beforeEach(() => {
        engine = new Engine({},{}, guardians, {})
    })

    describe("Leader election", () => {
        describe("Time based leader", () => {
            it("Should return true", () => {
                set(TASK_TIME_DIVISION_MIN*MS_TO_MINUTES*Object.keys(guardians).length);
                expect(engine.isLeaderTime()).to.be.true;
            });
        });
        describe("Hash based leader", () => {
            it("Should return true", () => {
                expect(engine.isLeaderHash("0x09c3be8189eb5bdd9ab559dcddb3ae09d2b394a5e96fef3566a32a72008d2")).to.be.true;
            });
        });
    });

    describe("Should run onInterval", () => {
        it("Should always return true for 1m", () => {
            expect(engine.shouldRunInterval("project", "1m")).to.be.true;
        });
        it("Should return true", () => {
            set(1668410745)
            expect(engine.shouldRunInterval("project1", "2m")).to.be.true;
        });
        it("Should return false", () => {
            set(1668410745)
            expect(engine.shouldRunInterval("project", "2m")).to.be.false;
        });
    });

    describe("Test handlers", async () => {
        let engine;
        beforeEach(() => {
            engine = new Engine({}, {'ethereum': {"id": 1, "rpcUrl": "https://fake.url"}}, guardians, new SignerMock())
            engine.loadModules({test: `${process.cwd()}/test/unit/index.js`});
        })

        class SignerMock {
            async ___manual___() {
                return Promise.resolve({key: process.env.PK})
            }
        }

        it("onInterval", async () => {
            set(TASK_TIME_DIVISION_MIN*MS_TO_MINUTES*Object.keys(guardians).length);
            await engine._onInterval()
            expect(engine.status.successTX).to.have.lengthOf(1)
            expect(engine.runningTasks).to.equal(0);
        });

        it("onCron", async () => {
            const lambda = engine.lambdas['test'][1]
            await engine._onCron(lambda)
            expect(engine.status.successTX).to.have.lengthOf(1)
            expect(engine.runningTasks).to.equal(0);
        });

        it("onEvent", async () => {
            const lambda = engine.lambdas['test'][2]
            await engine._onEvent({transactionHash: "0x09c3be8189eb5bdd9ab559dcddb3ae09d2b394a5e96fef3566a3232e088fa3"}, lambda)
            expect(engine.status.successTX).to.have.lengthOf(1)
            expect(engine.runningTasks).to.equal(0);
        });
    })
})