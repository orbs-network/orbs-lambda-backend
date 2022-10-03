import Signer from "orbs-signer-client";
import Web3 from "web3";
import {Lambda} from "./lambda";
import {scheduleJob} from "node-schedule";
import {convertIntervalToCron, validateCron} from "./utils";
import SignerProvider from 'ethjs-provider-signer';
import {AbiItem} from "web3-utils";
import {ContractOptions} from "web3-eth-contract";

export class Engine {
    private web3: {} = {};
    private storage: {};
    private guardians: any;
    public running: number;
    public isLeader: boolean
    public lambdas: {};
    private currentProject: string;
    private signer: Signer;

    constructor(networksMapping: {}, guardians: string[]) {
        this.signer = new Signer('http://localhost:7777');
        this.storage = {};
        this.guardians = guardians;
        this.running = 0;
        this.isLeader = this.checkIfLeader();
        this.lambdas = {};
        this.currentProject = "";
        this.initWeb3(networksMapping)
    }

    // _initWeb3(networksMapping) {
    //     const _this = this;
    //     for (const network in networksMapping) {
    //         const provider = new HookedWeb3Provider({
    //             host: networksMapping[network].rpcUrl,
    //             transaction_signer: {
    //                 hasAddress: function (address, callback) {
    //                     callback(null, true)
    //                 },
    //                 signTransaction: async (txData, cb) => {
    //                     const result = await _this.signer.sign(txData, 1);
    //                     cb(null, result.rawTransaction);
    //                 }
    //             }
    //         });
    //         this.web3[network] = new Web3(provider);
    //     }
    // }

    initWeb3(networksMapping) {
        const _this = this;
        for (const network in networksMapping) {
            const provider = new SignerProvider(networksMapping[network].rpcUrl, {
                signTransaction: async (txData, cb) => {
                    txData.gasLimit = txData.gas ?? await this.web3[network].eth.estimateGas(txData)
                    const result = await _this.signer.sign(txData, networksMapping[network].id);
                    cb(null, result.rawTransaction);
                }
            });
            this.web3[network] = new Web3(provider);
            this.web3[network].eth.defaultAccount = '0x216FF847E6e1cf55618FAf443874450f734885e0'; // for sendTransaction
            this.web3[network].eth.Contract = class CustomContract extends this.web3[network].eth.Contract {
                constructor(
                    jsonInterface: AbiItem[],
                    address?: string,
                    options?: ContractOptions
                ) {
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
            this.lambdas[project] = []
            require(tasksMap[project])(this);
        }
        console.log(this.lambdas)
    }

    checkIfLeader() {
        return true
    }

    onInterval(fn, {interval, network, config}) {
        const lambda = new Lambda(this.currentProject, fn.name, "onInterval")
        this.lambdas[this.currentProject].push(lambda)

        const _this = this;
        const crontab = convertIntervalToCron(interval);
        if (crontab) {
            scheduleJob(crontab, async function () {
                _this.running++;
                await fn(_this.web3[network], _this.storage, _this.guardians, config)
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
            scheduleJob(crontab, async function () {
                _this.running++;
                await fn(_this.web3[network], _this.storage, _this.guardians, config)
                _this.running--;
            });
        }
    }

    async onBlocks(fn, {network, config}) { // TODO
        const lambda = new Lambda(this.currentProject, fn.name, "onBlocks")
        this.lambdas[this.currentProject].push(lambda)

        this.running++;
        await fn(this.web3[network], this.storage, this.guardians, config)
        this.running--;
    }

    onEvent(fn, {contractAddress, abi, eventNames, network, config}) {
        const lambda = new Lambda(this.currentProject, fn.name, "onEvent")
        this.lambdas[this.currentProject].push(lambda)

        const _this = this;
        const web3 = this.web3[network];
        const contract = new web3.eth.Contract(abi, web3.utils.toChecksumAddress(contractAddress));
        for (const event of eventNames) {
            contract.events[event]({fromBlock: 'latest'})
                .on('data', async event => {
                    _this.running++;
                    await fn(web3, lambda.storage, _this.guardians, config, event)
                    _this.running--;
                })
                .on('changed', changed => console.log(changed))
                .on('error', err => console.log(err))
                .on('connected', str => console.log(`Listening to event ${str}`))
        }
    }
}