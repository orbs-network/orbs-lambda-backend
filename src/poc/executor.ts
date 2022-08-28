import {readdirSync, statSync} from "fs";
import {join} from "path";
import {scheduleJob} from "node-schedule";
import {parseExpression} from "cron-parser";
import Web3 from "web3";
import fetch from "node-fetch";
import path = require("path");

function getAllFiles(dirPath: string, arrayOfFiles: string[] = []) {
    const files = readdirSync(dirPath)
    arrayOfFiles = arrayOfFiles || []
    files.forEach(function(file) {
        if (statSync(dirPath + "/" + file).isDirectory()) {
            arrayOfFiles = getAllFiles(dirPath + "/" + file, arrayOfFiles)
        } else {
            arrayOfFiles.push(join(__dirname, dirPath, "/", file))
        }
    })
    return arrayOfFiles
}

function normalizeSchedulePattern(pattern: string) {
    const match = /(\d+) ?([mhd])/i.exec(pattern); // "every"
    if (match && match.length === 3) {
        const interval = match[1];
        const timeframe = match[2].toLowerCase();
        switch (timeframe) {
            case "m":
                return `*/${interval} * * * *`;
            case "h":
                return `0 */${interval} * * *`;
            case "d":
                return `0 0 */${interval} * *`;
        }
    }
    const size = pattern.split(' ').length;
    if (size < 5 || size > 6) throw "Invalid cron expression";
    const expression = size === 6 ? pattern.slice(0, pattern.lastIndexOf(' ')) : pattern;
    if (parseExpression(expression)) return expression;
    return '';
}

async function getGuardians(statusUrl: string) {
    const response = await fetch(statusUrl);
    const res = await response.json();
    const guardians: string[] = [];
    for (const address in res.CommitteeNodes) guardians.push(`0x${address}`);
    return guardians;
}

class Engine {
    private readonly web3: {};
    private storage: {};
    private guardians: any;
    public running: number;
    public isLeader: boolean
    public lambdaList: {};


    constructor(rpcUrls: {}, guardians: string[]) {
        this.web3 = {}
        for (const network in rpcUrls) {
            this.web3[network] = new Web3(rpcUrls[network])
        }
        this.storage = {};
        this.guardians = guardians;
        this.running = 0;
        this.isLeader = this.checkIfLeader()
        this.lambdaList = {}
    }

    checkIfLeader() {
        return true
    }

    onSchedule(fn, pattern, network, config) {
        const _this = this;
        pattern = normalizeSchedulePattern(pattern);
        if (pattern) {
            scheduleJob(normalizeSchedulePattern(pattern), async function () {
                _this.running++;
                await fn(_this.web3[network], _this.storage, _this.guardians, config)
                _this.running--;

            });
        }
    }

    onBlocks(condition: any, arg: any) {
        if (condition) console.log("onBlocks", arg)
    }

    onEvent(fn, contractAddress, abi, eventNames, network, config) {
        console.log(fn)
        const _this = this;
        const web3 = this.web3[network];
        const contract = new web3.eth.Contract(abi, web3.utils.toChecksumAddress(contractAddress));
        for (const event of eventNames) {
            contract.events[event]({fromBlock: 'latest'})
                .on('data', async event => {
                    _this.running++;
                    await fn(web3, _this.storage, _this.guardians, config, event)
                    _this.running--;
                })
                .on('changed', changed => console.log(changed))
                .on('error', err => console.log(err))
                .on('connected', str => console.log(`Listening to event ${str}`))
        }
    }
}

async function main() {
    const guardians = await getGuardians('https://status.orbs.network/json') // TODO localhost
    const engine = new Engine(
        {
            'polygon': "https://polygon-mainnet.g.alchemy.com/v2/ycYturL7FncO-c6xtUDKApfIFnorZToh",
            'ethereum': "wss://eth-mainnet.g.alchemy.com/v2/Q9NrK9t6txvHcqNCochAI0MNWQ3UTHFu"
        },
        guardians)

    // process.on('SIGINT', async function () {
    process.on('SIGTERM', async function () {
        while (engine.running) {
            console.log("Engine is still running. Waiting...");
            await new Promise(resolve => setTimeout(resolve, 1000)); // TODO: unsubscribe?
        }
        console.log("Shutting down")
        process.exit(0)
    })

    getAllFiles("../../src").forEach(fileName => {
        if (fileName.match("/projects\/.*index.js")) {
            const projectName = path.basename(path.dirname(fileName))
            console.log(projectName);
            require(fileName)(engine);
        }
    });
}


main().then().catch(e => console.log(e))
