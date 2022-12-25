import {ChildProcess, execSync, fork} from "child_process";
import {error, getCommittee, getCurrentVersion, getHumanUptime, log, parseArgs} from "./utils";
import {PROCESS_TIMEOUT, REPO_URL, MESSAGE_START, MESSAGE_GET_STATUS, MESSAGE_WRITE_STATUS} from "./constants";
import process from "process";
import * as _ from "lodash";
import {existsSync, mkdirSync, writeFileSync} from "fs";
import {dirname} from "path";

const children: {[id: string] : ChildProcess & {timestamp: number} } = {}


function writeStatus(state: any) {
    const now = new Date();
    const statusText = `tasksCount: ${state.tasksCount}, leaderName: ${state.leaderName}`;
    const status: any = {
        Status: statusText,
        Timestamp: now.toISOString(),
        Payload: {
            Uptime: Math.round((Date.now() - state.ServiceLaunchTime) / 1000),
            MemoryUsage: process.memoryUsage(),
            Version: {
                Semantic: getCurrentVersion(),
            },
            ...state,
            humanUptime: getHumanUptime(state.ServiceLaunchTime),
            lastUpdateUTC: now.toUTCString(),
            config
        }
    }
    if (state.error)
        status.Error = state.error;

    if (!existsSync(dirname(config.StatusJsonPath))) mkdirSync(dirname(config.StatusJsonPath), { recursive: true });
    const content = JSON.stringify(status, null, 2);
    writeFileSync(config.StatusJsonPath, content);
    console.log("Wrote status");
}

function restart(executorPath, committee) {
    // check for zombie processes
    const time = new Date().getTime();
    for (const id in children) {
        if (time - children[id].timestamp >= PROCESS_TIMEOUT ) {
            children[id].kill('SIGKILL');
            delete children[id];
        }
    }

    log("Starting executor instance...");
    const child = fork(executorPath);
    if (child.pid) {
        child.on("message", (message: {type: string, payload: any}) => {
            if (message.type === MESSAGE_WRITE_STATUS) writeStatus(message.payload);
        });
        child.on('exit', function (code) {
            log(`Shut down completed with exit code ${code}`);
            delete children[child.pid!];
        })
        child.send({type: MESSAGE_START, payload: {config, committee}});
        children[child.pid] = Object.assign({'timestamp': new Date().getTime()}, child); // add spawn timestamp to child object
        return child;
    }
    throw new Error("Failed to fork a new subprocess");
}

async function runLoop(config) {
    execSync('rm -rf orbs-lambda'); // remove old directory if exists
    execSync(`git clone -b ${config.gitTag} ${REPO_URL}`);
    let localRev = execSync('git rev-parse HEAD', {"cwd": "./orbs-lambda"}).toString().trim();

    let oldCommittee = {}

    let child;
    while (true) {
        // log("Checking for changes...")
        // Check for changes in committee
        let newCommittee = await getCommittee(config.mgmtServiceUrl);
        if (!_.isEqual(new Set(Object.keys(oldCommittee)), new Set(Object.keys(newCommittee)))) {
            log("Committee has changed, (re)starting...")
            child = restart(config.executorPath, newCommittee);
        }
        oldCommittee = newCommittee;

        // Check for changes in Git
        execSync(`git clone -b ${config.gitTag} ${REPO_URL} tmp`);
        const remoteRev = execSync('git rev-parse HEAD', {"cwd": "./tmp"}).toString().trim();
        if (localRev !== remoteRev) {
            console.log(`New commit found: ${remoteRev}`);
            execSync('rm -rf orbs-lambda && mv tmp orbs-lambda');
            child = restart(config.executorPath, newCommittee);
            localRev = remoteRev;
        } else execSync('rm -rf tmp');

        child.send({type: MESSAGE_GET_STATUS});
        await new Promise(resolve => setTimeout(resolve, 60000));
    }
}

log('Service Lambda started.');
const config = parseArgs(process.argv);
// log(`Input config: '${JSON.stringify(config)}'.`);
runLoop(config).catch((err) => {
    log('Exception thrown from runLoop, shutting down:');
    error(err.stack);
    process.exit(128);
});