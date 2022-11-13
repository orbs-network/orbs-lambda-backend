import Signer from "orbs-signer-client";
import Web3 from "web3";
import {Lambda} from "./lambda";
import {scheduleJob} from "node-schedule";
import {log, error, hashStringToNumber, intervalToMinutes, validateCron} from "./utils";
import {AbiItem} from "web3-utils";
import {ContractOptions} from "web3-eth-contract";
import {SignerProvider} from "./customProvider"
import {TASK_TIME_DIVISION_MIN, MS_TO_MINUTES} from './constants'

export class Engine {
    private web3: {} = {};
    private readonly guardians: {};
    public runningTasks: number;
    public lambdas: {};
    private currentProject: string;
    private signer: Signer;
    private readonly selfAddress: string;
    private readonly selfIndex: number;
    public isShuttingDown: boolean;
    private networksMapping: {};

    constructor(networksMapping: {}, guardians: {}, selfAddress) {
        this.signer = new Signer('http://localhost:7777');
        this.guardians = guardians;
        this.runningTasks = 0;
        this.selfAddress = selfAddress;
        this.selfIndex = this.getGuardianIndex();
        this.lambdas = {};
        this.currentProject = "";
        this.isShuttingDown = false;
        this.networksMapping = networksMapping;
    }

    initWeb3(network) {
        const _this = this;
        const provider = new SignerProvider({
            host: this.networksMapping[network].rpcUrl,
            signTransaction: async (txData, cb) => {
                try {
                    txData.gasLimit = txData.gas ?? await this.web3[network].eth.estimateGas(txData)
                    const result = await _this.signer.sign(txData, this.networksMapping[network].id);
                    cb(null, result.rawTransaction);
                } catch (e) {
                    // @ts-ignore
                    error(e.message)
                }
            }
        });
        const web3 = new Web3(provider);
        web3.eth.defaultAccount = this.selfAddress; // for sendTransaction
        // @ts-ignore
        web3.eth.Contract = class CustomContract extends web3.eth.Contract {
            constructor(jsonInterface: AbiItem[], address?: string, options?: ContractOptions) {
                super(jsonInterface, address, options);
                // @ts-ignore
                this.options.from = _this.selfAddress;
            }
        }
        return web3;
    }

    getCurrentLeaderIndex(): number {
        return Math.floor(Date.now() / (TASK_TIME_DIVISION_MIN * MS_TO_MINUTES)) % Object.keys(this.guardians).length;
    }

    getGuardianIndex() {
        return Object.keys(this.guardians).indexOf(this.selfAddress);
    }

    isLeaderTime() {
        // return true;
        return this.getCurrentLeaderIndex() === this.selfIndex;
    }

    isLeaderBlock() {  // TODO
        return true
    }

    isLeaderEvent(txHash) {
        return parseInt(txHash) % Object.keys(this.guardians).length === Object.keys(this.guardians).indexOf(this.selfAddress);
    }

    shouldRunInterval(projectName, interval) {
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
            const web3 = args.network ? _this.initWeb3([args.network]) : undefined;
            const params = {
                web3: web3,
                guardians: this.guardians,
            }
            scheduleJob(crontab, async function () {
                if (!_this.isShuttingDown && _this.isLeaderTime()) {
                    _this.runningTasks++;
                    lambda.isRunning = true;
                    try {
                        await fn(params);
                    } catch (e) {
                        error(`Task ${fn.name} failed with error: ${e}`);
                    } finally {
                        lambda.isRunning = false;
                        _this.runningTasks--;
                        // @ts-ignore
                        if (web3) web3.currentProvider.disconnect();
                    }
                }
            });
        }
    }

    async onBlocks(fn, args) { // TODO

        if (!this.isShuttingDown && this.isLeaderBlock()) {
            const lambda = new Lambda(this.currentProject, fn.name, "onBlocks", fn, args)
            this.lambdas[this.currentProject].push(lambda);

            const web3 = args.network ? this.initWeb3([args.network]) : undefined;
            const params = {
                web3: web3,
                guardians: this.guardians,
            }
            this.runningTasks++;
            lambda.isRunning = true;
            try {
                await fn(params);
            } catch (e) {
                error(`Task ${fn.name} failed with error: ${e}`);
            } finally {
                lambda.isRunning = false;
                this.runningTasks--;
                // @ts-ignore
                await web3.currentProvider.disconnect();
            }
        }
    }

    onEvent(fn, args) {
        const {contractAddress, abi, eventName, network, filter} = args;
        const lambda = new Lambda(this.currentProject, fn.name, "onEvent", fn, args)
        this.lambdas[this.currentProject].push(lambda)

        const _this = this;
        const web3 = this.initWeb3(network);
        const params = {
            web3: network ? web3 : undefined,
            guardians: this.guardians,
        }
        // separate between the web3 object that's being passed to the handler (and later disposed) and the persistent one used for event listening
        const web3Listener = this.initWeb3(network);
        const contract = new web3Listener.eth.Contract(abi, web3.utils.toChecksumAddress(contractAddress));
        contract.events[eventName]({fromBlock: 'latest', filter})
            .on('data', async event => {
                if (!_this.isShuttingDown && this.isLeaderEvent(event.transactionHash)) {
                    _this.runningTasks++;
                    lambda.isRunning = true;
                    try {
                        await fn(Object.assign(params, {event}));
                    } catch (e) {
                        error(`Task ${fn.name} failed with error: ${e}`);
                    } finally {
                        lambda.isRunning = false;
                        this.runningTasks--;
                        // @ts-ignore
                        await web3.currentProvider.disconnect();
                    }
                }
            })
            .on('changed', changed => log(changed))
            .on('error', err => log(err))
            .on('connected', str => log(`Listening to event ${str}`))
    }

    run(tasksMap) {
        for (const project in tasksMap) {
            this.currentProject = project;
            this.lambdas[project] = [];
            const module = require(tasksMap[project]);
            module.register(this);
        }
        log(this.lambdas)

        // handle onInterval tasks
        const _this = this;
        scheduleJob("* * * * *", async function() {
            if (!_this.isShuttingDown && _this.isLeaderTime()) {
                for (const projectName in _this.lambdas) {
                    for (const lambda of _this.lambdas[projectName]) {
                        if (lambda.type === "onInterval" && _this.shouldRunInterval(projectName, lambda.args.interval)) { // TODO: ENUM TYPES?
                            _this.runningTasks++;
                            lambda.isRunning = true;
                            try {
                                await lambda.fn(lambda.args);
                            } catch (e) {
                                error(`Task ${lambda.fn.name} failed with error: ${e}`);
                            } finally {
                                lambda.isRunning = false;
                                _this.runningTasks--;
                                // @ts-ignore
                                await web3.currentProvider.disconnect();
                            }
                        }
                    }
                }
            }
        })
    }
}