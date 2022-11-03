import {resolve} from "path";
import {execSync, fork} from "child_process";
import {PROCESS_TIMEOUT, GIT_TAG} from "./constants";
import {log, error} from "./utils";
import fetch from "node-fetch";
import * as _ from 'lodash';

class Syncer {
    private children = {}
    private readonly program: any;
    private readonly mgmtServiceUrl: any;
    private readonly statusUrl: any;

    constructor(executorPath, mgmtServiceUrl, statusUrl) {
        this.program = resolve(executorPath);
        this.mgmtServiceUrl = mgmtServiceUrl
        this.statusUrl = statusUrl
    }

    async getCommittee() {
        let response = await fetch(this.mgmtServiceUrl);
        const mgmt = await response.json();
        response = await fetch(this.statusUrl);
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

    async restart(committee) {
        log("Starting executor instance...");
        const child = fork(this.program);
        if (child.pid) {
            child.send(committee);
            this.children[child.pid] = Object.assign({'timestamp': new Date().getTime()}, child); // add spawn timestamp to child object
            const _this = this;
            child.on('exit', function (code) {
                log(`Shut down completed with exit code ${code}`);
                // @ts-ignore
                delete _this.children[child.pid];
            })
        } else error("Failed to fork a new subprocess"); // TODO

        const time = new Date().getTime();
        for (const id in this.children) {
            if (time - this.children[id].timestamp >= PROCESS_TIMEOUT && child.pid) {
                this.children[id].kill('SIGKILL');
                delete this.children[child.pid];
            }
        }
    }

    async run() {
        execSync('rm -rf orbs-lambda'); // remove old directory if exists
        execSync(`git clone -b ${GIT_TAG} https://github.com/orbs-network/orbs-lambda`);
        let localRev = execSync('git rev-parse HEAD', {"cwd": "./orbs-lambda"}).toString().trim();

        let oldCommittee = {}

        while (true) {
            log("Checking for changes...")
            // Check for changes in committee
            let newCommittee = await this.getCommittee();
            if (!_.isEqual(new Set(Object.keys(oldCommittee)), new Set(Object.keys(newCommittee)))) {
                log("Committee has changed, restarting...")
                await this.restart(newCommittee);
            }
            oldCommittee = newCommittee;
            await new Promise(resolve => setTimeout(resolve, 60000));

            // Check for changes in Git
            execSync(`git clone -b ${GIT_TAG} https://github.com/orbs-network/orbs-lambda tmp`);
            const remoteRev = execSync('git rev-parse HEAD', {"cwd": "./tmp"}).toString().trim();
            if (localRev !== remoteRev) {
                console.log(`New commit found: ${remoteRev}`);
                execSync('rm -rf orbs-lambda && mv tmp orbs-lambda');
                await this.restart(newCommittee);
                localRev = remoteRev;
            } else execSync('rm -rf tmp');
        }
    }
}

// const program = resolve('executor.js');
// const child = fork(program);
// child.on('exit', function (code) {
//     log(`Engine ${child.pid} shut down completed with exit code ${code}`);
// })
//
// setTimeout(() => {
//     fork(program);
//     child.kill();
// }, 5000);

const syncer = new Syncer('executor.js','http://54.95.108.148/services/management-service/status', 'https://status.orbs.network/json')
syncer.run().then()