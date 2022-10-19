import Signer from "orbs-signer-client";
import Web3 from "web3";
import {Lambda} from "./lambda";
import {scheduleJob} from "node-schedule";
import {hashStringToNumber, intervalToMinutes, validateCron} from "./utils";
import {AbiItem} from "web3-utils";
import {ContractOptions} from "web3-eth-contract";
import {SignerProvider} from "./customProvider"

const TASK_TIME_DIVISION_MIN = 167; // prime number to reduce task miss and span guardians more equally
const MS_TO_MINUTES = 60 * 1000;

export class Engine {
    private web3: {} = {};
    private readonly guardians: {};
    public running: number;
    public lambdas: {};
    private currentProject: string;
    private signer: Signer;
    private readonly selfAddress: string;
    private readonly selfIndex: number;

    constructor(networksMapping: {}, guardians: {}, selfAddress) {
        this.signer = new Signer('http://localhost:7777');
        this.guardians = guardians;
        this.running = 0;
        this.selfAddress = selfAddress;
        this.selfIndex = this.getGuardianIndex();
        this.lambdas = {};
        this.currentProject = "";
        this.initWeb3(networksMapping)
    }

    initWeb3(networksMapping) {
        const _this = this;
        for (const network in networksMapping) {
            const provider = new SignerProvider({
                host: networksMapping[network].rpcUrl,
                signTransaction: async (txData, cb) => {
                    txData.gasLimit = txData.gas ?? await this.web3[network].eth.estimateGas(txData)
                    const result = await _this.signer.sign(txData, networksMapping[network].id);
                    cb(null, result.rawTransaction);
                }
            });
            this.web3[network] = new Web3(provider);
            this.web3[network].eth.defaultAccount = this.selfAddress; // for sendTransaction
            this.web3[network].eth.Contract = class CustomContract extends this.web3[network].eth.Contract {
                constructor(jsonInterface: AbiItem[], address?: string, options?: ContractOptions) {
                    super(jsonInterface, address, options);
                    // @ts-ignore
                    this.options.from = this.selfAddress;
                }
            }
        }
    }

    getCurrentLeaderIndex(): number {
        return Math.floor(Date.now() / (TASK_TIME_DIVISION_MIN * MS_TO_MINUTES)) % Object.keys(this.guardians).length;
    }

    getGuardianIndex() {
        return Object.keys(this.guardians).indexOf(this.selfAddress);
    }

    isLeaderTime() {
        return this.getCurrentLeaderIndex() === this.selfIndex;
    }

    isLeaderBlock() {  // TODO
        return true
    }

    isLeaderEvent(txHash) {
        return parseInt(txHash) % Object.keys(this.guardians).length === Object.keys(this.guardians).indexOf(this.selfAddress);
    }

    shouldRun(projectName, interval) {
        const epochMinutes = Math.floor(new Date().getTime()/MS_TO_MINUTES);
        const intervalMinutes = intervalToMinutes(interval);
        const offset = hashStringToNumber(projectName) % intervalMinutes;
        return !((epochMinutes - offset) % intervalMinutes);
    }

    // ---- handlers ---- //

    onInterval(fn, args) {
        const lambda = new Lambda(this.currentProject, fn.name, "onInterval", fn, args);
        this.lambdas[this.currentProject].push(lambda);
    }

    onCron(fn, args) {
        const lambda = new Lambda(this.currentProject, fn.name, "onCron", fn, args)
        this.lambdas[this.currentProject].push(lambda)

        const _this = this;
        const crontab = validateCron(args.cron);
        if (crontab) {
            const params = {
                web3: args.network ? _this.web3[args.network] : undefined,
                guardians: this.guardians,
                config: args.config
            }
            scheduleJob(crontab, async function () {
                if (_this.isLeaderTime()) {
                    _this.running++;
                    await fn(params)
                    _this.running--;
                }
            });
        }
    }

    async onBlocks(fn, args) { // TODO
        const lambda = new Lambda(this.currentProject, fn.name, "onBlocks", fn, args)
        this.lambdas[this.currentProject].push(lambda)
        const params = {
            web3: args.network ? this.web3[args.network] : undefined,
            guardians: this.guardians,
            config: args.cong
        }
        this.running++;
        await fn(params)
        this.running--;
    }

    onEvent(fn, args) {
        const {contractAddress, abi, eventName, network, filter, config} = args;
        const lambda = new Lambda(this.currentProject, fn.name, "onEvent", fn, args)
        this.lambdas[this.currentProject].push(lambda)

        const _this = this;
        const web3 = this.web3[network];
        const params = {
            web3: network ? web3 : undefined,
            guardians: this.guardians,
            config
        }
        const contract = new web3.eth.Contract(abi, web3.utils.toChecksumAddress(contractAddress));
        contract.events[eventName]({fromBlock: 'latest', filter})
            .on('data', async event => {
                if (this.isLeaderEvent(event.transactionHash)) {
                    _this.running++;
                    await fn(Object.assign(params, {event}))
                    _this.running--;
                }
            })
            .on('changed', changed => console.log(changed))
            .on('error', err => console.log(err))
            .on('connected', str => console.log(`Listening to event ${str}`))
    }

    run(tasksMap) {
        for (const project in tasksMap) {
            this.currentProject = project;
            this.lambdas[project] = [];
            const module = require(tasksMap[project]);
            module.register(this);
        }
        console.log(this.lambdas)

        // handle onInterval tasks
        const _this = this;
        scheduleJob("* * * * *", async function() {
            if (_this.isLeaderTime()) {
                for (const projectName in _this.lambdas) {
                    for (const lambda of _this.lambdas[projectName]) {
                        if (lambda.type === "onInterval" && _this.shouldRun(projectName, lambda.args.interval)) { // TODO: ENUM TYPES?
                            _this.running++;
                            await lambda.fn(lambda.args);
                            _this.running--;
                        }
                    }
                }
            }
        })
    }
}