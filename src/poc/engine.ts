import Signer from "orbs-signer-client";
import Web3 from "web3";
import {Lambda} from "./lambda";
import {scheduleJob} from "node-schedule";
import {convertIntervalToCron, validateCron} from "./utils";
import {AbiItem} from "web3-utils";
import {ContractOptions} from "web3-eth-contract";
import {SignerProvider} from "./customProvider"

export class Engine {
    private web3: {} = {};
    private readonly guardians: any;
    public running: number;
    public isLeader: boolean
    public lambdas: {};
    private currentProject: string;
    private signer: Signer;

    constructor(networksMapping: {}, guardians: {}) {
        this.signer = new Signer('http://localhost:7777');
        this.guardians = guardians;
        this.running = 0;
        this.isLeader = this.checkIfLeader();
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
            this.web3[network].eth.defaultAccount = '0x216FF847E6e1cf55618FAf443874450f734885e0'; // for sendTransaction
            this.web3[network].eth.Contract = class CustomContract extends this.web3[network].eth.Contract {
                constructor(jsonInterface: AbiItem[], address?: string, options?: ContractOptions) {
                    super(jsonInterface, address, options);
                    // @ts-ignore
                    this.options.from = '0x216FF847E6e1cf55618FAf443874450f734885e0';
                }
            }
        }
    }

    run(tasksMap) {
        for (const project in tasksMap) {
            this.currentProject = project;
            this.lambdas[project] = [];
            const module = require(tasksMap[project]);
            module.register(this);
        }
        console.log(this.lambdas)
    }

    checkIfLeader() {  // TODO
        return true
    }

    onInterval(fn, {interval, network, config}) {
        const lambda = new Lambda(this.currentProject, fn.name, "onInterval")
        this.lambdas[this.currentProject].push(lambda)

        const _this = this;
        const crontab = convertIntervalToCron(interval);
        if (crontab) {
            const args = {
                web3: network ? _this.web3[network] : undefined,
                guardians: this.guardians,
                config
            }
            scheduleJob(crontab, async function () {
                _this.running++;
                await fn(args)
                _this.running--;
            });
        }
    }

    onCron(fn, {cron, network, config}) {
        const lambda = new Lambda(this.currentProject, fn.name, "onCron")
        this.lambdas[this.currentProject].push(lambda)

        const _this = this;
        const crontab = validateCron(cron);
        if (crontab) {
            const args = {
                web3: network ? _this.web3[network] : undefined,
                guardians: this.guardians,
                config
            }
            scheduleJob(crontab, async function () {
                _this.running++;
                await fn(args)
                _this.running--;
            });
        }
    }

    async onBlocks(fn, {network, config}) { // TODO
        const lambda = new Lambda(this.currentProject, fn.name, "onBlocks")
        this.lambdas[this.currentProject].push(lambda)
        const args = {
            web3: network ? this.web3[network] : undefined,
            guardians: this.guardians,
            config
        }
        this.running++;
        await fn(args)
        this.running--;
    }

    onEvent(fn, {contractAddress, abi, eventNames, network, filter, config}) {
        const lambda = new Lambda(this.currentProject, fn.name, "onEvent")
        this.lambdas[this.currentProject].push(lambda)

        const _this = this;
        const web3 = this.web3[network];
        const args = {
            web3: network ? web3 : undefined,
            guardians: this.guardians,
            config
        }
        const contract = new web3.eth.Contract(abi, web3.utils.toChecksumAddress(contractAddress));
        for (const event of eventNames) {
            contract.events[event]({fromBlock: 'latest', filter})
                .on('data', async event => {
                    _this.running++;
                    await fn(Object.assign(args, {event}))
                    _this.running--;
                })
                .on('changed', changed => console.log(changed))
                .on('error', err => console.log(err))
                .on('connected', str => console.log(`Listening to event ${str}`))
        }
    }
}