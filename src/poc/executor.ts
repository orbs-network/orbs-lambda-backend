import {readdirSync, statSync} from "fs";
import {join} from "path";
import fetch from "node-fetch";
import path = require("path");
import {Engine} from "./engine";

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
    return arrayOfFiles;
}

async function getGuardians(mgmtServiceUrl: string, statusUrl: string) {
    let response = await fetch(mgmtServiceUrl);
    const mgmt = await response.json();
    response = await fetch(statusUrl);
    const status = await response.json();

    const guardians = {};
    for (const node of mgmt.Payload.CurrentCommittee) {
        const gAddress = `0x${node.EthAddress}`;
        const gStatus = status.CommitteeNodes[node.EthAddress];
        guardians[gAddress] = {
                weight: node.Weight,
                nodeAddress: `0x${gStatus.OrbsAddress}`,
                ip: gStatus.Ip
            };
    }
    return guardians;
}

async function main() {
    const tasksList = {};
    getAllFiles("../../src").forEach(fileName => {
        if (fileName.match("/projects\/.*index.js")) {
            const projectName = path.basename(path.dirname(fileName))
            tasksList[projectName] = fileName;
        }
    });

    const guardians = await getGuardians('http://54.95.108.148/services/management-service/status', 'https://status.orbs.network/json') // TODO localhost
    const engine = new Engine(
        {
            'polygon': {"id": 137, "rpcUrl": "wss://polygon-mainnet.g.alchemy.com/v2/ycYturL7FncO-c6xtUDKApfIFnorZToh"},
            'ethereum': {"id": 1, "rpcUrl": "wss://eth-mainnet.g.alchemy.com/v2/Q9NrK9t6txvHcqNCochAI0MNWQ3UTHFu"},
            'bsc': {"id": 56, "rpcUrl": "wss://bsc-mainnet.nodereal.io/ws/v1/64a9df0874fb4a93b9d0a3849de012d3"},
            "goerli": {"id": 5, rpcUrl: "wss://eth-goerli.g.alchemy.com/v2/_zIVzADTWU5y41UKIybGjUSbd3RAW8TL"}
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

    engine.run(tasksList);
}


main().then().catch(e => console.log(e))
