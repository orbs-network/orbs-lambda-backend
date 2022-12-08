import {expect} from "chai";
import {beforeEach} from "mocha";
import {Engine} from "../../src/engine";
import {guardians} from "../fixtures";
import {set} from 'mockdate'
import {MS_TO_MINUTES, TASK_TIME_DIVISION_MIN} from "../../src/constants";
import {intervalToMinutes, validateCron, getMatchingFiles, getCommittee} from "../../src/utils";

// describe("Utils", () => {
//     it("Should return a task list", () => {
//         expect(getMatchingFiles("./test/e2e")).to.not.be.empty;
//     })
//     it("Should have exactly 1 guardian as current node", async () => {
//         const committee = await getCommittee("http://54.95.108.148/services/management-service/status");
//         // @ts-ignore
//         const current = Object.values(committee).filter(x => x.currentNode)
//         expect(current).to.have.lengthOf(1);
//     })
//     it("Should return valid expression (len 5)", () => {
//         const pattern = "* * * * *";
//         expect(validateCron(pattern)).to.equal(pattern);
//     });
//     it("Should return valid expression (len 6)", () => {
//         const pattern = "* * * * * *";
//         expect(validateCron(pattern)).to.equal("* * * * *");
//     });
//     it("Should throw error", () => {
//         const pattern = "* * * *";
//         expect(() => validateCron(pattern)).to.throw();
//     });
//     it("Should throw invalid expression", () => {
//         const pattern = "* * * * x";
//         expect(() => validateCron(pattern)).to.throw();
//     });
//     it("Should throw invalid interval", () => {
//         const pattern = "1x";
//         expect(() => intervalToMinutes(pattern)).to.throw();
//     });
// })
//
// describe("Engine", () => {
//     let engine: Engine;
//     beforeEach(() => {
//         engine = new Engine({}, guardians)
//     })
//
//     describe("Leader election", () => {
//         describe("Time based leader", () => {
//             it("Should return true", () => {
//                 set(TASK_TIME_DIVISION_MIN*MS_TO_MINUTES*Object.keys(guardians).length);
//                 expect(engine.isLeaderTime()).to.be.true;
//             });
//         });
//         describe("Hash based leader", () => {
//             it("Should return true", () => {
//                 expect(engine.isLeaderHash("0x09c3be8189eb5bdd9ab559dcddb3ae09d2b394a5e96fef3566a3232e088fa3")).to.be.true;
//             });
//         });
//     });
//
//     describe("Should run onInterval", () => {
//         it("Should always return true for 1m", () => {
//             expect(engine.shouldRunInterval("project", "1m")).to.be.true;
//         });
//         it("Should return true", () => {
//             set(1668410745)
//             expect(engine.shouldRunInterval("project", "2m")).to.be.true;
//         });
//         it("Should return false", () => {
//             set(1668410745)
//             expect(engine.shouldRunInterval("project1", "2m")).to.be.false;
//         });
//     });
//
// })