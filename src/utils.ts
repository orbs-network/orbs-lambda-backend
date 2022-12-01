import {parseExpression} from "cron-parser";
import {readdirSync, statSync} from "fs";
import path from "path";
import _process from "process";
import fetch from "node-fetch";
import process from "process";
import Web3 from "web3";

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

export async function calcGasPrice(chainId, baseFee, urgencyInSeconds, maxGasPrice) {
    if (maxGasPrice && maxGasPrice > baseFee) {
        const res = await fetch(`https://api.owlracle.info/v3/${chainId}/gas?eip1559=false&accept=10,15,20,25,30,35,40,45,50,55,60,65,70,75,80,85,90,95,100&apikey=${process.env.OWLRACLE_APIKEY}`);
        if (res.status === 200) {
            const data = await res.json();
            let acceptance = urgencyInSeconds ? 1 - Math.pow(0.01, data.avgTime / urgencyInSeconds) : 0.75 // acceptance within the desired time with 99% probability. (https://www.statology.org/probability-of-at-least-two). default is 0.75
            const price = data.speeds.find(speed => {
                if (speed.acceptance >= acceptance) return speed.gasPrice
            }).gasPrice
            const maxPrice = maxGasPrice ? Math.min(price, maxGasPrice) : price;
            return Web3.utils.toHex(Web3.utils.toWei(maxPrice.toString(), 'gwei'));
        } else error(`Owlracle request failed with status code ${res.status}`);
    } else log(`maxGasPrice ${maxGasPrice} < base fee ${baseFee}`)
}