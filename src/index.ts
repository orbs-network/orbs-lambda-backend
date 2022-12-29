import {ChildProcess, execSync, fork} from "child_process";
import {debug, error, getCommittee, getCurrentVersion, getHumanUptime, log, parseArgs} from "./utils";
import {PROCESS_TIMEOUT, REPO_URL, MESSAGE_START, MESSAGE_GET_STATUS, MESSAGE_WRITE_STATUS} from "./constants";
import process from "process";
import * as _ from "lodash";
import {existsSync, mkdirSync, writeFileSync} from "fs";
import {dirname, join} from "path";
import {Status} from "./interfaces";

const children: {[id: string] : {instance: ChildProcess, killTimestamp: number} } = {}
const workdir = process.env.WORKDIR ?? process.cwd();

function getConfig() {
    const confPath = `./config_${process.env.NODE_ENV}.json`;
    const config = parseArgs(process.argv, confPath);
    config.projectsDir = join(workdir, config.projectsDir);
    config.statusJsonPath = join(workdir, config.statusJsonPath);
    config.executorPath = join(workdir, config.executorPath);
    return config;
}
function writeStatus(state: any) {
    const now = new Date();
    state.ServiceLaunchTime = launchTime;
    const statusText = `tasksCount: ${state.tasksCount}, leaderName: ${state.leaderName}`;
    const status: Status = {
        Status: statusText,
        Timestamp: now.toISOString(),
        Payload: {
            Uptime: Math.round((Date.now() - state.ServiceLaunchTime) / 1000),
            MemoryUsage: process.memoryUsage(),
            Version: {
                Semantic: getCurrentVersion(workdir),
            },
            ...state,
            humanUptime: getHumanUptime(state.ServiceLaunchTime),
            lastUpdateUTC: now.toUTCString(),
            config
        }
    }
    if (state.error)
        status.Error = state.error;

    if (!existsSync(dirname(config.statusJsonPath))) mkdirSync(dirname(config.statusJsonPath), { recursive: true });
    const content = JSON.stringify(status, null, 2);
    writeFileSync(config.statusJsonPath, content);
    debug("Wrote status");
}

function restart(executorPath, committee, oldChild) {
    // kill the current Engine instance, if exists
    if (oldChild) {
        children[oldChild.pid].killTimestamp = new Date().getTime();
        oldChild.kill();
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
        children[child.pid] = {instance: child, killTimestamp: 0};

        // check for zombie processes
        const time = new Date().getTime();
        for (const id in children) {
            if (children[id].killTimestamp && time - children[id].killTimestamp >= PROCESS_TIMEOUT ) {
                children[id].instance.kill('SIGKILL');
            }
        }
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
        debug("Checking for changes...")
        // Check for changes in committee
        let newCommittee = await getCommittee(config.mgmtServiceUrl);
        if (!_.isEqual(new Set(Object.keys(oldCommittee)), new Set(Object.keys(newCommittee)))) {
            log("Committee has changed, (re)starting...")
            child = restart(config.executorPath, newCommittee, child);
        }
        oldCommittee = newCommittee;

        // Check for changes in Git
        execSync(`git clone -b ${config.gitTag} ${REPO_URL} tmp`);
        const remoteRev = execSync('git rev-parse HEAD', {"cwd": "./tmp"}).toString().trim();
        if (localRev !== remoteRev) {
            console.log(`New commit found: ${remoteRev}`);
            execSync('rm -rf orbs-lambda && mv tmp orbs-lambda');
            child = restart(config.executorPath, newCommittee, child);
            localRev = remoteRev;
        } else execSync('rm -rf tmp');

        child.send({type: MESSAGE_GET_STATUS});
        await new Promise(resolve => setTimeout(resolve, 60000));
    }
}

const launchTime = Date.now();
log(`Service Lambda started. env = ${process.env.NODE_ENV}`);
const config = getConfig()
debug(`Input config: '${JSON.stringify(config)}'.`);
runLoop(config).catch((err) => {
    log('Exception thrown from runLoop, shutting down:');
    error(err.stack);
    process.exit(128);
});