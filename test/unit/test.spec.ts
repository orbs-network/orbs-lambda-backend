import {expect} from "chai";
import {beforeEach} from "mocha";
import {Engine} from "../../src/engine";
import {guardians} from "../fixtures";
import {set} from 'mockdate'
import {MS_TO_MINUTES, TASK_TIME_DIVISION_MIN} from "../../src/constants";
import {intervalToMinutes, validateCron} from "../../dist/utils";

describe("Engine", () => {
    let instance: Engine;
    beforeEach(() => {
        instance = new Engine({}, guardians, '')
    })

    describe("Leader election", () => {
        describe("Time based leader", () => {
            it("Should return true", () => {
                set(TASK_TIME_DIVISION_MIN*MS_TO_MINUTES*Object.keys(guardians).length);
                expect(instance.isLeaderTime()).to.be.true;
            });
        });
        describe("Hash based leader", () => {
            it("Should return true", () => {
                expect(instance.isLeaderHash("0x09c3be8189eb5bdd9ab559dcddb3ae09d2b394a5e96fef3566a3232e088fa3")).to.be.true;
            });
        });
    });

    describe("Should run onInterval", () => {
        it("Should always return true for 1m", () => {
            expect(instance.shouldRunInterval("project", "1m")).to.be.true;
        });
        it("Should return true", () => {
            set(1668410745)
            expect(instance.shouldRunInterval("project", "2m")).to.be.true;
        });
        it("Should return false", () => {
            set(1668410745)
            expect(instance.shouldRunInterval("project1", "2m")).to.be.false;
        });
    });

    describe("validateCron", () => {
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
    })
})