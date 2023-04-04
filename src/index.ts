import {ChildProcess, execSync, fork} from "child_process";
import {biSend, debug, error, getCommittee, getCurrentVersion, getHumanUptime, log, parseArgs, getCurrentGuardian} from "./utils";
import {
    PROCESS_TIMEOUT,
    REPO_URL,
    MESSAGE_START,
    MESSAGE_GET_STATUS,
    MESSAGE_WRITE_STATUS,
    SLEEP_DURATION,
    MS_TO_MINUTES,
} from "./constants";
import process from "process";
import * as _ from "lodash";
import {existsSync, mkdirSync, writeFileSync} from "fs";
import {dirname, join} from "path";
import {Status} from "./interfaces";

const children: {[id: string] : {instance: ChildProcess, killTimestamp: number} } = {}
const workdir = process.env.WORKDIR ?? process.cwd();
let ERRORS: string[] = [];
let statusTimeout;
let responsePromise;

function getConfig() {
    const confPath = `./config_${process.env.NODE_ENV}.json`;
    const config = parseArgs(process.argv, confPath);
    config.projectsDir = join(workdir, config.projectsDir);
    config.statusJsonPath = join(workdir, config.statusJsonPath);
    config.executorPath = join(workdir, config.executorPath);
    return config;
}

function writeStatus(state: any = {}) {
    const now = new Date();
    state.ServiceLaunchTime = launchTime;
    const statusText = `tasksCount: ${state.tasksCount}, leaderName: ${state.leaderName}`;
    const status: Status = {
        Status: statusText,
        Timestamp: now.toISOString(),
        humanUptime: state.ServiceLaunchTime ? getHumanUptime(state.ServiceLaunchTime) : "0",
        lastUpdateUTC: now.toUTCString(),
        Payload: {
            Uptime: state.ServiceLaunchTime ? Math.round((Date.now() - state.ServiceLaunchTime) / 1000) : 0,
            MemoryUsage: process.memoryUsage(),
            Version: {
                Semantic: getCurrentVersion(workdir),
            },
            ...state,
            config
        }
    }
    const errors: string[] = state.errors ? state.errors.concat(ERRORS): ERRORS;
    ERRORS = [];
    if (errors.length)
        status.Error = errors.join('\n');

    if (!existsSync(dirname(config.statusJsonPath))) mkdirSync(dirname(config.statusJsonPath), { recursive: true });
    const content = JSON.stringify(status, null, 2);
    writeFileSync(config.statusJsonPath, content);
    debug(`Wrote status\n${content}`);
    biSend(config.BIUrl, {type: "balances", ...state.balance})
}

function restart(executorPath, committee, oldChild) {
    const time = new Date().getTime();
    // kill the current Executor instance, if exists
    if (oldChild) {
        children[oldChild.pid].killTimestamp = time;
        oldChild.kill();
    }

    log("Starting executor instance...");
    const child = fork(executorPath);
    if (child.pid) {
        responsePromise = new Promise((resolve) => {
            child.on("message", (message: { type: string, payload: any }) => {
                switch (message.type) {
                    case MESSAGE_WRITE_STATUS:
                        resolve(message.payload);
                        break;
                    default:
                        error(`Unsupported message type: ${message.type}`)
                }
            });
        });
        child.on('exit', async function (code) {
            biSend(config.BIUrl, {type: 'shutDown', pid: child.pid, code})
            log(`Shut down completed with exit code ${code}`);
            delete children[child.pid!];
        })
        child.send({type: MESSAGE_START, payload: {config, committee}});
        children[child.pid] = {instance: child, killTimestamp: 0};

        // check for zombie processes
        for (const id in children) {
            if (children[id].killTimestamp && time - children[id].killTimestamp >= PROCESS_TIMEOUT) {
                log(`Process ${id} is running for more than ${PROCESS_TIMEOUT / MS_TO_MINUTES} minutes. Killing...`);
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
        debug("Checking for changes...");
        // Check for changes in committee
        let newCommittee;
        try {
            newCommittee = await getCommittee(config.mgmtServiceUrl);
            if (!_.isEqual(new Set(Object.keys(oldCommittee)), new Set(Object.keys(newCommittee)))) {
                log("Committee has changed, (re)starting...");
                biSend(config.BIUrl, {type: 'newCommittee', committee: Object.keys(newCommittee)});
                process.env['NODENAME'] = getCurrentGuardian(newCommittee) ?? process.env.NODE_ENV ?? 'debug';
                child = restart(config.executorPath, newCommittee, child);
            }
            oldCommittee = newCommittee;
        } catch (e) {
            error(`Failed to get new committee: ${e}`);
            newCommittee = oldCommittee;
        }

        try {
            // Check for changes in Git
            execSync(`git clone -b ${config.gitTag} ${REPO_URL} tmp`);
            const remoteRev = execSync('git rev-parse HEAD', {"cwd": "./tmp"}).toString().trim();
            if (localRev !== remoteRev) {
                log(`New commit found: ${remoteRev}`);
                execSync('rm -rf orbs-lambda && mv tmp orbs-lambda');
                biSend(config.BIUrl, {type: 'newCommit', commitHash: remoteRev})
                child = restart(config.executorPath, newCommittee, child);
                localRev = remoteRev;
            } else execSync('rm -rf tmp');
        }
        catch (e) {
            handleError(`Failed to check for git changes: ${e}`);
        }


        // ask child process for status. If no response comes back - restart it
        statusTimeout = setTimeout(() => {
            console.error('Child process did not respond within 5 seconds');
            child = restart(config.executorPath, newCommittee, child);
        }, 5000);
        child.send({type: MESSAGE_GET_STATUS});
        responsePromise.then((response) => {
            clearTimeout(statusTimeout);
            writeStatus(response);
        });

        await new Promise(resolve => setTimeout(resolve, SLEEP_DURATION));
    }
}

function handleError(errMsg, exit= false) {
    error(errMsg);
    biSend(config.BIUrl, {type: "error", errMsg});
    ERRORS.push(errMsg);
    if (exit) {
        writeStatus()
        process.exit(128);
    }
}

process.on('uncaughtException', function (err, origin) {
    handleError(`Caught exception: ${err}\nException origin: ${origin}`, true);
});

const launchTime = Date.now();
log(`Service Lambda started. env = ${process.env.NODE_ENV}`);
const config = getConfig()
debug(`Input config: '${JSON.stringify(config)}'`);
runLoop(config).catch((err) => {
    handleError(`Exception thrown from runLoop, shutting down: ${err.stack}`, true);
});