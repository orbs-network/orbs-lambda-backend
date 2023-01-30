import {parseExpression} from "cron-parser";
import {readdirSync, readFileSync, statSync} from "fs";
import path from "path";
import fetch from "node-fetch";
import process from "process";
import Web3 from "web3";
import utils from "web3-utils";
import {SOURCE_API, SOURCE_FEE_HISTORY} from "./constants";
import yargs from 'yargs';
import {Config} from "./interfaces";
import {createHash} from "crypto";
import BigNumber from "bignumber.js";

export function intervalToMinutes(pattern: string) : number {
    const match = /(\d+) ?([mhd])/i.exec(pattern);
    if (match && match.length === 3) {
        const interval = parseInt(match[1]);
        const timeframe = match[2].toLowerCase();
        switch (timeframe) {
            case "m":
                return interval;
            case "h":
                return interval * 60;
            case "d":
                return interval * 60 * 24;
        }
    }
    throw new Error("Invalid pattern")
}

export function validateCron(pattern: string) : string {
    const size = pattern.split(' ').length;
    if (size < 5 || size > 6) throw new Error("Invalid cron expression");
    const expression = size === 6 ? pattern.slice(0, pattern.lastIndexOf(' ')) : pattern;
    if (parseExpression(expression)) return expression;
    return '';
}

export function hashStringToNumber(str) {
    const hash = str.startsWith("0x") ? str : createHash('sha256').update(str).digest('hex');
    return new BigNumber(hash, 16);
}

export function log(obj) {
    const str = typeof(obj) === 'object' ? JSON.stringify(obj, undefined, 2) : obj;
    console.log(`${new Date().toISOString()} <${process.pid}> ${str}`)
}

export function error(obj) {
    const str = typeof(obj) === 'object' ? JSON.stringify(obj, undefined, 2) : obj;
    console.error(`${new Date().toISOString()} <${process.pid}> ERROR: ${str}`)
}

export function debug(obj) {
    if (process.env.NODE_ENV === "prod") return;
    const str = typeof(obj) === 'object' ? JSON.stringify(obj, undefined, 2) : obj;
    console.log(`${new Date().toISOString()} <${process.pid}> DEBUG: ${str}`)
}


export function getMatchingFiles(dirPath: string, projectsPattern: string, arrayOfFiles: string[] = []) {
    const files = readdirSync(dirPath)
    arrayOfFiles = arrayOfFiles || []
    files.forEach(function (file) {
        if (statSync(dirPath + "/" + file).isDirectory()) {
            arrayOfFiles = getMatchingFiles(dirPath + "/" + file, projectsPattern, arrayOfFiles)
        } else {
            const fileName = path.join(dirPath, "/", file);
            if (fileName.match(projectsPattern)) arrayOfFiles.push(fileName)
        }
    })
    return arrayOfFiles;
}

export async function getCommittee(mgmtServiceUrl) {
    let response = await fetch(mgmtServiceUrl);
    const mgmt = await response.json();
    const selfAddress = mgmt.Payload.Config['node-address'].toLowerCase()

    const guardians = {};
    for (const node of mgmt.Payload.CurrentCommittee) {
        const g = mgmt.Payload.CurrentTopology.find(x => x.EthAddress === node.EthAddress)
        guardians[node.Name] = {
            weight: node.Weight,
            nodeAddress: `0x${g.OrbsAddress}`,
            guardianAddress: `0x${node.EthAddress}`,
            ip: g.Ip,
            currentNode: g.OrbsAddress === selfAddress
        };
    }
    return guardians;
}

export async function calcGasPrice(apiKey, chainId, feeHistory, providedPriorityFee) {
    const historyBaseFee = feeHistory.baseFeePerGas[0];
    const historyPriorityFee = feeHistory.reward[0][0];
    const res = await fetch(`https://api.owlracle.info/v3/${chainId}/gas?reportwei=true&accept=75&apikey=${apiKey}`);
    if (res.status === 200) {
        debug("Successfully fetched gas data from Owlracle")
        const data = await res.json();
        const apiMaxFee = data.speeds[0].maxFeePerGas;
        const apiPriorityFee = data.speeds[0].maxPriorityFeePerGas;
        return {
            maxFeePerGas: apiMaxFee >= historyBaseFee ? apiMaxFee : Web3.utils.toHex(utils.toBN(historyBaseFee).mul(utils.toBN(2)).add(utils.toBN(apiPriorityFee))),
            maxPriorityFeePerGas: providedPriorityFee ?? data.speeds[0].maxPriorityFeePerGas,
            source: SOURCE_API
        }
    }
    error(`Owlracle request failed with status code ${res.status}`);
    return {
        maxFeePerGas: Web3.utils.toHex(utils.toBN(historyBaseFee).mul(utils.toBN(2)).add(utils.toBN(historyPriorityFee))),
        maxPriorityFeePerGas: providedPriorityFee ?? historyPriorityFee,
        source: SOURCE_FEE_HISTORY
    }
}

export function parseArgs(argv: string[], confPath): Config {
    // management service passes the default configs as a cli arg ("--config config.json --config keys.json")
    // need to parse those and add our custom config to them

    let res;
    const customConfig : Config = JSON.parse(readFileSync(confPath).toString());

    // parse command line args
    const args = yargs(argv)
        .option('config', {
            type: 'array',
            required: false,
            string: true,
            default: [confPath],
            description: 'list of config files',
        })
        .exitProcess(false)
        .parse();

    // read input config JSON files coming from argv + custom config
    try {
        res = Object.assign(
            {},
            customConfig,
            ...args.config.map((configPath) => JSON.parse(readFileSync(configPath).toString()))
        );
    } catch (err) {
        error(`Cannot parse input JSON config files: [${args.config}].`);
        throw err;
    }
    return res;
}

export function getCurrentVersion(workdir) {
  try {
    return readFileSync(`${workdir}/.version`).toString().trim();
  } catch (err) {
    error(`Could not find version: ${err}`);
  }
  return '';
}

export function getHumanUptime(uptime): string {
    // get total seconds between the times
    let delta = Math.abs(Date.now() - uptime) / 1000;
    // calculate (and subtract) whole days
    const days = Math.floor(delta / 86400);
    delta -= days * 86400;
    // calculate (and subtract) whole hours
    const hours = Math.floor(delta / 3600) % 24;
    delta -= hours * 3600;
    // calculate (and subtract) whole minutes
    const minutes = Math.floor(delta / 60) % 60;
    delta -= minutes * 60;
    // what's left is seconds
    const seconds = delta % 60;  // in theory the modulus is not required
    return `${days} days : ${hours}:${minutes}:${seconds}`;
}

export async function biSend(url: string, bi: any) {
    bi.procName = process.env.npm_config_name;
    bi.procVersion = process.env.npm_config_version;
    bi.hostname = process.env.NODE_ENV ?? 'debug';

    const prom = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bi)
    }).catch((e) => {
        error('biSend: ' + e.message)
    });
    debug(bi)
    return prom;
}