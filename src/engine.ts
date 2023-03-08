import Web3 from "web3";
import {Lambda} from "./lambda";
import {scheduleJob} from "node-schedule";
import {
    biSend,
    calcGasPrice,
    debug,
    error,
    getProjectOffset,
    hashStringToNumber,
    intervalToMinutes,
    log,
    validateCron
} from "./utils";
import {AbiItem} from "web3-utils";
import {ContractOptions} from "web3-eth-contract";
import {MS_TO_MINUTES, TASK_TIME_DIVISION_MIN, REWARDS_PERCENTILES, MAX_LAST_TX, TYPE_ON_CRON, TYPE_ON_INTERVAL, TYPE_ON_BLOCKS, TYPE_ON_EVENT} from './constants';
import {CustomProvider} from "./customProvider";
import process from "process";
import {parseExpression} from "cron-parser";

export class Engine {
    private readonly guardians: {};
    public runningTasks: number;
    public lambdas: {};
    private currentProject: string;
    readonly selfIndex: number;
    public isShuttingDown: boolean;
    private readonly networksMapping: {};
    private readonly signer: any;
    selfName: string;
    readonly status: { nextInvocations: {}[], tasks: {}; myNode: any; successTX: any[]; failTX: any[]; balance: {}; leaderName: string; isLeader: boolean; leaderIndex: number; tasksCount: number; EngineLaunchTime: number, errors: string[] };
    private readonly tasksMap: any;
    private readonly alwaysLeader: boolean;
    private readonly config: any;

    constructor(tasksMap, networksMapping: {}, guardians: {[name: string] : {weight: number, nodeAddress: string, guardianAddress: string, ip: string, currentNode: boolean}}, signer, config) {
        this.alwaysLeader = process.env.NODE_ENV !== 'prod';
        this.tasksMap = tasksMap;
        this.signer = signer;
        this.guardians = guardians;
        this.runningTasks = 0;
        this.selfName = process.env['NODENAME']!;
        this.selfIndex = Object.keys(guardians).indexOf(this.selfName);
        this.lambdas = {};
        this.currentProject = "";
        this.isShuttingDown = false;
        this.networksMapping = networksMapping;
        this.config = config;
        this.status = {
            EngineLaunchTime: Date.now(),
            tasksCount: 0,
            isLeader: false,
            leaderIndex: -1,
            leaderName: '',
            tasks: {},
            nextInvocations: [],
            successTX: [],
            failTX: [],
            balance: {},
            myNode: this.guardians[this.selfName],
            errors: []
        };
    }

    async initWeb3(network, reconnect=false) {
        const options = reconnect ? {
            clientConfig: {
                keepalive: true,
                keepaliveInterval: 60000
            },
            reconnect: {
                auto: true,
                delay: 5000,
                maxAttempts: 5,
                onTimeout: false
            }
        } : {}
        const provider = new CustomProvider(this.networksMapping[network].rpcUrl, options)
        const web3 = new Web3(provider)

        const _this = this;
        const fn = web3.eth.accounts.signTransaction;
        web3.eth.accounts.signTransaction = async function signTransaction(tx, privateKey, callback)  {
            tx.gas = tx.gas ?? await web3.eth.estimateGas(tx);
            // @ts-ignore
            if (_this.networksMapping[network].eip1559 && (tx.type === '0x2' || tx.type === 2 || tx.type === undefined)) { // EIP-1559
                delete tx.gasPrice;
                if (!tx.maxFeePerGas) {
                    const feeHistory = await web3.eth.getFeeHistory(1, "pending", REWARDS_PERCENTILES);
                    const gasPrice = await calcGasPrice(_this.config.owlracleApikey, _this.networksMapping[network].id, feeHistory, tx.maxPriorityFeePerGas);
                    tx.maxFeePerGas = gasPrice.maxFeePerGas
                    tx.maxPriorityFeePerGas = gasPrice.maxPriorityFeePerGas
                }
            }
            log(tx)
            const singedTX = await fn.call(this, tx, privateKey, callback);
            web3['transactionHash'] = singedTX.transactionHash;
            return singedTX;
        }

        const account = web3.eth.accounts.privateKeyToAccount(`0x${(await this.signer.___manual___()).key}`);
        web3.eth.accounts.wallet.add(account);

        web3.eth.defaultAccount = account.address; // for sendTransaction

        // @ts-ignore
        web3.eth.Contract = class CustomContract extends web3.eth.Contract {
            constructor(jsonInterface: AbiItem[], address?: string, options?: ContractOptions) {
                super(jsonInterface, address, options);
                this.options.from = account.address;
            }
        }

        // @ts-ignore
        web3.currentProvider.on('end', (error) => {log(`Web3 connection disconnected: ${error}`)})
            .on('error', e => error(`WS Error: ${e}`));

        return web3;
    }

    getCurrentLeaderIndex(): number {
        return Math.floor(Date.now() / (TASK_TIME_DIVISION_MIN * MS_TO_MINUTES)) % Object.keys(this.guardians).length;
    }

    isLeaderTime() {
        return this.alwaysLeader || this.getCurrentLeaderIndex() === this.selfIndex;
    }

    isLeaderHash(str: string) {
        const num = hashStringToNumber(str);
        return this.alwaysLeader || Number(num.modulo(Object.keys(this.guardians).length)) === this.selfIndex;
    }

    shouldRunInterval(projectName, interval, offset) {
        const epochMinutes = Math.floor(new Date().getTime()/MS_TO_MINUTES);
        const intervalMinutes = intervalToMinutes(interval);
        return !((epochMinutes - offset) % intervalMinutes);
    }

    async _runTask(lambda, extraParams= {}) {
        const web3 : Web3 & {transactionHash?: string} | undefined = lambda.args.network ? await this.initWeb3([lambda.args.network]) : undefined;
        const params = Object.assign({web3, guardians: this.guardians}, extraParams);
        let tx = `${new Date().toISOString()} ${lambda.args.network} ${lambda.projectName} ${lambda.taskName} ${lambda.type}`;
        let bi: any = {
            type: 'execTask',
            nodeName: this.selfName,
            network: lambda.args.network,
            projectName: lambda.projectName,
            taskName: lambda.taskName,
            lambdaType: lambda.type,
            sender: this.selfName
        }
        try {
            biSend(this.config.BIUrl, bi);
            this.runningTasks++;
            lambda.isRunning = true;
            await lambda.fn(params);
            if (web3 && web3.transactionHash) {
                tx += ` ${web3.transactionHash}`;
                bi.transactionHash = web3.transactionHash;
            }
            log(`TX success: ${tx}`);
            this.status.successTX.unshift(tx);
            bi.success = true;
        }
        catch (e) {
            bi.success = false;
            if (web3 && web3.transactionHash) {
                tx += ` ${web3.transactionHash}`;
                bi.transactionHash = web3.transactionHash;
            }
            const errMsg = `Task ${lambda.fn.name} failed with error: ${e}`
            error(errMsg);
            this.status.errors.push(errMsg);
            this.status.failTX.unshift(tx);
        }
        finally {
            bi.type = 'sentTX';
            biSend(this.config.BIUrl, bi)
            lambda.isRunning = false;
            this.runningTasks--;
            // @ts-ignore
            if (web3) await web3.currentProvider.disconnect();
        }
    }

    async _onInterval() {
        if (!this.isShuttingDown && this.isLeaderTime()) {
            for (const projectName in this.lambdas) {
                for (const lambda of this.lambdas[projectName]) {
                    if (lambda.type === TYPE_ON_INTERVAL && this.shouldRunInterval(projectName, lambda.args.interval, lambda.offset)) {
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
        const offset = getProjectOffset(this.currentProject, fn.name, args, intervalToMinutes(args.interval));
        const lambda = new Lambda(this.currentProject, fn.name, TYPE_ON_INTERVAL, fn, args, offset);
        this.lambdas[this.currentProject].push(lambda);
    }

    onCron(fn, args) {
        const lambda = new Lambda(this.currentProject, fn.name, TYPE_ON_CRON, fn, args)
        this.lambdas[this.currentProject].push(lambda)

        const _this = this;
        const crontab = validateCron(args.cron);
        if (crontab) {
            scheduleJob(crontab, async function () {
                await _this._onCron(lambda);
            });
        }
    }

    async onBlocks(fn, args) { // TODO
        // const lambda = new Lambda(this.currentProject, fn.name, TYPE_ON_BLOCKS, fn, args)
        // this.lambdas[this.currentProject].push(lambda);
        if (!this.isShuttingDown && this.isLeaderHash('')) {
            const lambda = new Lambda(this.currentProject, fn.name, TYPE_ON_BLOCKS, fn, args)
            this.lambdas[this.currentProject].push(lambda);
            await this._runTask(lambda)
        }
    }

    async onEvent(fn, args) {
        const {contractAddress, abi, eventName, network, filter} = args;
        const lambda = new Lambda(this.currentProject, fn.name, TYPE_ON_EVENT, fn, args)
        this.lambdas[this.currentProject].push(lambda)

        // separate between the web3 object that's being passed to the handler (and later disposed) and the persistent one used for event listening
        const web3Listener = await this.initWeb3(network, true);
        const contract = new web3Listener.eth.Contract(abi, web3Listener.utils.toChecksumAddress(contractAddress));

        const _this = this;
        contract.events[eventName]({fromBlock: 'latest', filter})
            .on('data', async event => {
                await _this._onEvent(event, lambda);
            })
            .on('changed', changed => log(changed))
            .on('error', err => {
                error(err);
                _this.status.errors.push(err);
            })
            .on('connected', str => log(`Listening to event ${str}`))
    }

    async getBalance(network) {
        const web3 = await this.initWeb3(network);
        const balance = await web3.eth.getBalance(web3.eth.accounts.wallet[0].address);
        return parseInt(balance)/10**18;
    }

    getNextInvocations() {
        const nextInvocations: {}[] = [];
        for (const project in this.lambdas) {
            for (const task of this.lambdas[project]) {
                if (task.type === TYPE_ON_INTERVAL) {
                    const intervalMinutes = intervalToMinutes(task.args.interval);
                    const epochMinutes = Math.floor(new Date().getTime()/MS_TO_MINUTES);
                    const mod = epochMinutes % intervalMinutes;
                    const next = task.offset > mod ? new Date((epochMinutes - mod + task.offset)*MS_TO_MINUTES) : new Date((epochMinutes - mod + task.offset + intervalMinutes)*MS_TO_MINUTES);
                    nextInvocations.push({[`${task.projectName}_${task.taskName}`]: next.toUTCString()});
                }
                else if (task.type === TYPE_ON_CRON) {
                    const interval = parseExpression(task.args.cron, {tz: 'UTC'});
                    //@ts-ignore
                    nextInvocations.push({[`${task.projectName}_${task.taskName}`]: new Date(interval.next()._date.ts).toUTCString()});
                }
            }
        }
        return nextInvocations;
    }

    async generateState() {
        // @ts-ignore
        this.status.tasksCount = Object.values(this.lambdas).reduce((a,b) => a+b.length, 0);
        const leaderIndex = this.getCurrentLeaderIndex();
        this.status.leaderIndex = leaderIndex;
        this.status.leaderName = Object.keys(this.guardians)[leaderIndex];
        this.status.isLeader = this.alwaysLeader || this.isLeaderTime();
        this.status.tasks = this.lambdas;
        this.status.nextInvocations = this.getNextInvocations();
        this.status.successTX.splice(MAX_LAST_TX);
        this.status.failTX.splice(MAX_LAST_TX);
        for (const network in this.networksMapping) {
            this.status.balance[network] = await this.getBalance(network);
        }

        return this.status;
    }

    loadModules(tasksMap) {
        for (const project in tasksMap) {
            this.currentProject = project;
            this.lambdas[project] = [];
            const module = require(tasksMap[project]);
            module.register(this);
        }
        debug(this.lambdas)
    }

    run() {
        this.loadModules(this.tasksMap)

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
        //                 if (lambda.type === TYPE_ON_BLOCKS) {
        //                     const params = {
        //                         web3: await _this.initWeb3(lambda.args.network),
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