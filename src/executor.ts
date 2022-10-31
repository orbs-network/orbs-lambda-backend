import {readdirSync, statSync} from "fs";
import fetch from "node-fetch";
import * as path from 'path';
import {Engine} from "./engine";
import dotenv from 'dotenv';
import * as _process from "process";
import {log, error} from "./utils";

// TODO: Executor class?
function getAllFiles(dirPath: string, arrayOfFiles: string[] = []) {
    const files = readdirSync(dirPath)
    arrayOfFiles = arrayOfFiles || []
    files.forEach(function(file) {
        if (statSync(dirPath + "/" + file).isDirectory()) {
            arrayOfFiles = getAllFiles(dirPath + "/" + file, arrayOfFiles)
        } else {
            arrayOfFiles.push(path.join(__dirname, dirPath, "/", file))
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
    dotenv.config({path: path.resolve(__dirname, '../.env')});
    const tasksList = {};
    getAllFiles("../src").forEach(fileName => {
        if (fileName.match("/projects\/.*index.js")) {
            const projectName = path.basename(path.dirname(fileName))
            tasksList[projectName] = fileName;
        }
    });

    const selfAddress = "0x216FF847E6e1cf55618FAf443874450f734885e0"; // TODO
    const guardians = await getGuardians('http://54.95.108.148/services/management-service/status', 'https://status.orbs.network/json') // TODO localhost
    const engine = new Engine(
        {
            'polygon': {"id": 137, "rpcUrl": _process.env.POLYGON_PROVIDER},
            'ethereum': {"id": 1, "rpcUrl": _process.env.ETHEREUM_PROVIDER},
            'bsc': {"id": 56, "rpcUrl": _process.env.BSC_PROVIDER},
            "goerli": {"id": 5, rpcUrl: _process.env.GOERLI_PROVIDER}
        },
        guardians,
        selfAddress)

    process.on('unhandledRejection', (reason, promise) => {
        error(`Unhandled Rejection at: ${promise}, reason: ${reason}`);
    });

    process.on('uncaughtException', function(err, origin) {
        error(`Caught exception: ${err}\nException origin: ${origin}`);
    });

    ['SIGINT', 'SIGTERM', 'SIGQUIT'].forEach(signal => process.on(signal, async () => {
        log(`Engine received ${signal} signal`)
        engine.isShuttingDown = true;
        const t = new Date().getTime();
        while (engine.runningTasks) {
            let runningTasks = "";
            for (const project in engine.lambdas) {
                for (const lambda of engine.lambdas[project]) {
                    if (lambda.isRunning) runningTasks += `${project}, ${lambda.taskName}\n`
                }
            }
            log(`Still running ${engine.runningTasks} tasks:\n${runningTasks}Waiting for ${(new Date().getTime()-t)/1000} seconds to finish...`);
            await new Promise(resolve => setTimeout(resolve, 3000));
        }
        process.exit();
    }));

    engine.run(tasksList);
}


main().then().catch(e => error(e))
