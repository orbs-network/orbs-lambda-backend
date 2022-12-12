import {parseExpression} from "cron-parser";
import {readdirSync, statSync} from "fs";
import path from "path";
import _process from "process";
import fetch from "node-fetch";
import process from "process";
import Web3 from "web3";
import utils from "web3-utils";
import {API, FEE_HISTORY} from "./constants";

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

export function hashStringToNumber(str) : number {
    let hash = 5381;
    let i = str.length;
    while(i) {
        hash = (hash * 33) ^ str.charCodeAt(--i);
    }
    return hash >>> 0;
    // return Math.abs(str.split('').reduce((a,b) => (((a << 5) - a) + b.charCodeAt(0))|0, 0));
}

export function log(obj) {
    const str = typeof(obj) === 'object' ? JSON.stringify(obj, undefined, 2) : obj;
    console.log(`<${process.pid}> ${str}`)
}

export function error(obj) {
    const str = typeof(obj) === 'object' ? JSON.stringify(obj, undefined, 2) : obj;
    console.error(`<${process.pid}> ERROR: ${str}`)
}

export function getMatchingFiles(dirPath: string, arrayOfFiles: string[] = []) {
    const files = readdirSync(dirPath)
    arrayOfFiles = arrayOfFiles || []
    files.forEach(function (file) {
        if (statSync(dirPath + "/" + file).isDirectory()) {
            arrayOfFiles = getMatchingFiles(dirPath + "/" + file, arrayOfFiles)
        } else {
            const fileName = path.join(__dirname, dirPath, "/", file);
            if (fileName.match(_process.env.PROJECTS_PATTERN!)) arrayOfFiles.push(fileName)
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
        const gAddress = `0x${node.EthAddress}`;
        const g = mgmt.Payload.CurrentTopology.find(x => x.EthAddress === node.EthAddress)
        guardians[gAddress] = {
            weight: node.Weight,
            nodeAddress: `0x${g.OrbsAddress}`,
            ip: g.Ip,
            currentNode: g.OrbsAddress === selfAddress
        };
    }
    return guardians;
}

export async function calcGasPrice(chainId, feeHistory, providedPriorityFee) {
    const historyBaseFee = feeHistory.baseFeePerGas[0];
    const historyPriorityFee = feeHistory.reward[0][0];
    const res = await fetch(`https://api.owlracle.info/v3/${chainId}/gas?reportwei=true&accept=75&apikey=${process.env.OWLRACLE_APIKEY}`);
    if (res.status === 200) {
        log("Successfully fetched from Owlracle")
        const data = await res.json();
        const apiMaxFee = data.speeds[0].maxFeePerGas;
        const apiPriorityFee = data.speeds[0].maxPriorityFeePerGas;
        return {
            maxFeePerGas: apiMaxFee >= historyBaseFee ? apiMaxFee : Web3.utils.toHex(utils.toBN(historyBaseFee).mul(utils.toBN(2)).add(utils.toBN(apiPriorityFee))),
            maxPriorityFeePerGas: providedPriorityFee ?? data.speeds[0].maxPriorityFeePerGas,
            source: API
        }
    }
    error(`Owlracle request failed with status code ${res.status}`);
    return {
        maxFeePerGas: Web3.utils.toHex(utils.toBN(historyBaseFee).mul(utils.toBN(2)).add(utils.toBN(historyPriorityFee))),
        maxPriorityFeePerGas: providedPriorityFee ?? historyPriorityFee,
        source: FEE_HISTORY
    }
}