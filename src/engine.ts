import Web3 from "web3";
import {Lambda} from "./lambda";
import {scheduleJob} from "node-schedule";
import {calcGasPrice, error, hashStringToNumber, intervalToMinutes, log, validateCron} from "./utils";
import utils, {AbiItem} from "web3-utils";
import {ContractOptions} from "web3-eth-contract";
import {MS_TO_MINUTES, TASK_TIME_DIVISION_MIN} from './constants'
import {CustomProvider} from "./customProvider";

export class Engine {
    private readonly guardians: {};
    public runningTasks: number;
    public lambdas: {};
    private currentProject: string;
    private readonly selfAddress: string;
    readonly selfIndex: number;
    public isShuttingDown: boolean;
    private networksMapping: {};
    private readonly pk: string;

    constructor(networksMapping: {}, guardians: {[key: string] : {weight: number, nodeAddress: string, ip: string, currentNode: boolean}}, selfAddress, pk) {
        this.guardians = guardians;
        this.runningTasks = 0;
        this.selfAddress = selfAddress;
        this.pk = pk;
        this.selfIndex = this.getGuardianIndex();
        this.lambdas = {};
        this.currentProject = "";
        this.isShuttingDown = false;
        this.networksMapping = networksMapping;
    }

    initWeb3(network) {
        const _this = this;
        const provider = new CustomProvider(this.networksMapping[network].rpcUrl)
        const web3 = new Web3(provider)

        const fn = web3.eth.accounts.signTransaction;
        web3.eth.accounts.signTransaction = async function signTransaction(tx, privateKey, callback)  {
            tx.gas = tx.gas ?? await web3.eth.estimateGas(tx);
            // @ts-ignore
            if (tx.type === '0x2' || tx.type === undefined) { // EIP-1559
                delete tx.gasPrice;
                if (!tx.maxFeePerGas) {
                    const gasPrice = await calcGasPrice(_this.networksMapping[network].id);
                    if (gasPrice) {
                        tx.maxFeePerGas = Web3.utils.toHex(Web3.utils.toWei(gasPrice["maxFeePerGas"].toString(), 'gwei'));
                        tx.maxPriorityFeePerGas = tx.maxPriorityFeePerGas ?? Web3.utils.toHex(Web3.utils.toWei(gasPrice["maxPriorityFeePerGas"].toString(), 'gwei'));
                    } else { // calculation has returned an error
                        const feeHistory = await web3.eth.getFeeHistory(1, "latest", [0.75]);
                        tx.maxFeePerGas = Web3.utils.toHex(utils.toBN(feeHistory.baseFeePerGas[0])
                            .mul(utils.toBN(2))
                            .add(utils.toBN(feeHistory.reward[0][0])));
                        tx.maxPriorityFeePerGas = tx.maxPriorityFeePerGas ?? feeHistory.reward[0][0];
                    }
                }
            }
            console.log(tx)
            return fn.call(this, tx, privateKey, callback);
        }

        const account = web3.eth.accounts.privateKeyToAccount(this.pk);
        web3.eth.accounts.wallet.add(account);

        web3.eth.defaultAccount = account.address; // for sendTransaction

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

    isLeaderHash(hash: string) {
        // return true;
        const num = hashStringToNumber(hash)
        return num % Object.keys(this.guardians).length === Object.keys(this.guardians).indexOf(this.selfAddress);
    }

    shouldRunInterval(projectName, interval) {
        const epochMinutes = Math.floor(new Date().getTime()/MS_TO_MINUTES);
        const intervalMinutes = intervalToMinutes(interval);
        const offset = hashStringToNumber(projectName) % intervalMinutes;
        return !((epochMinutes - offset) % intervalMinutes);
    }

    async _runTask(lambda, extraParams= {}) {
        const web3 = lambda.args.network ? this.initWeb3([lambda.args.network]) : undefined;
        const params = Object.assign({web3, guardians: this.guardians}, extraParams);
        this.runningTasks++;
        lambda.isRunning = true;
        try {
            await lambda.fn(params);
        } catch (e) {
            error(`Task ${lambda.fn.name} failed with error: ${e}`);
        } finally {
            lambda.isRunning = false;
            this.runningTasks--;
            // @ts-ignore
            await web3.currentProvider.disconnect();
        }
    }

    async _onInterval() {
        if (!this.isShuttingDown && this.isLeaderTime()) {
            for (const projectName in this.lambdas) {
                for (const lambda of this.lambdas[projectName]) {
                    if (lambda.type === "onInterval" && this.shouldRunInterval(projectName, lambda.args.interval)) { // TODO: ENUM TYPES?
                        await this._runTask(lambda)
                    }
                }
            }
        }
    }

    async _onCron(lambda) {
        if (!this.isShuttingDown && this.isLeaderTime()) {
            await this._runTask(lambda)
        }
    }

    async _onEvent(event, lambda) {
        if (!this.isShuttingDown && this.isLeaderHash(event.transactionHash)) {
            await this._runTask(lambda, {event})
        }
    }

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
            scheduleJob(crontab, async function () {
                await _this._onCron(lambda)
            });
        }
    }

    async onBlocks(fn, args) { // TODO
        // const lambda = new Lambda(this.currentProject, fn.name, "onBlocks", fn, args)
        // this.lambdas[this.currentProject].push(lambda);
        if (!this.isShuttingDown && this.isLeaderHash('')) {
            const lambda = new Lambda(this.currentProject, fn.name, "onBlocks", fn, args)
            this.lambdas[this.currentProject].push(lambda);

            const web3 = args.network ? this.initWeb3([args.network]) : undefined;
            const params = {
                web3,
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

            // fn(params).catch(e => error(`Task ${fn.name} failed with error: ${e}`)).finally(async () => {
            //     lambda.isRunning = false;
            //     this.runningTasks--;
            //     // @ts-ignore
            //     if (web3) await web3.currentProvider.disconnect();
            // });
        }
    }

    onEvent(fn, args) {
        const {contractAddress, abi, eventName, network, filter} = args;
        const lambda = new Lambda(this.currentProject, fn.name, "onEvent", fn, args)
        this.lambdas[this.currentProject].push(lambda)

        // separate between the web3 object that's being passed to the handler (and later disposed) and the persistent one used for event listening
        const web3Listener = this.initWeb3(network);
        const contract = new web3Listener.eth.Contract(abi, web3Listener.utils.toChecksumAddress(contractAddress));

        const _this = this;
        contract.events[eventName]({fromBlock: 'latest', filter})
            .on('data', async event => {
                await _this._onEvent(event, lambda)
            })
            .on('changed', changed => log(changed))
            .on('error', err => log(err))
            .on('connected', str => log(`Listening to event ${str}`))
    }

    loadModules(tasksMap) {
        for (const project in tasksMap) {
            this.currentProject = project;
            this.lambdas[project] = [];
            const module = require(tasksMap[project]);
            module.register(this);
        }
        log(this.lambdas)
    }

    run(tasksMap) {
        this.loadModules(tasksMap)

        const _this = this;
        // handle onInterval tasks
        scheduleJob("* * * * *", async function() {
            await _this._onInterval()
        })

        // handle onBlocks tasks TODO
        // scheduleJob("* * * * *", async function() {
        //     if (!_this.isShuttingDown && _this.isLeaderHash('')) {
        //         for (const projectName in _this.lambdas) {
        //             for (const lambda of _this.lambdas[projectName]) {
        //                 if (lambda.type === "onBlocks") { // TODO: ENUM TYPES?
        //                     const params = {
        //                         web3: _this.initWeb3(lambda.args.network),
        //                         guardians: _this.guardians,
        //                     }
        //                     _this.runningTasks++;
        //                     lambda.isRunning = true;
        //                     try {
        //                         await lambda.fn(params);
        //                     } catch (e) {
        //                         error(`Task ${lambda.fn.name} failed with error: ${e}`);
        //                     } finally {
        //                         lambda.isRunning = false;
        //                         _this.runningTasks--;
        //                         // @ts-ignore
        //                         await web3.currentProvider.disconnect();
        //                     }
        //                 }
        //             }
        //         }
        //     }
        // })
    }
}