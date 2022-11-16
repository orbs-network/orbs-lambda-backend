import path, {resolve} from "path";
import {execSync, fork} from "child_process";
import {PROCESS_TIMEOUT, REPO_URL} from "./constants";
import {error, log} from "./utils";
import fetch from "node-fetch";
import * as _ from 'lodash';
import * as process from "process";
import dotenv from 'dotenv';

class Syncer {
    private children = {}
    private readonly program: any;

    constructor(executorPath) {
        this.program = resolve(executorPath);
    }

    async getCommittee() {
        let response = await fetch(process.env.MGMT_SERVICE_URL!);
        const mgmt = await response.json();
        response = await fetch(process.env.STATUS_URL!);
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

    restart(committee) {
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
        execSync(`git clone -b ${process.env.GIT_TAG} ${REPO_URL}`);
        let localRev = execSync('git rev-parse HEAD', {"cwd": "./orbs-lambda"}).toString().trim();

        let oldCommittee = {}

        while (true) {
            log("Checking for changes...")
            // Check for changes in committee
            let newCommittee = await this.getCommittee();
            if (!_.isEqual(new Set(Object.keys(oldCommittee)), new Set(Object.keys(newCommittee)))) {
                log("Committee has changed, (re)starting...")
                this.restart(newCommittee);
            }
            oldCommittee = newCommittee;

            // Check for changes in Git
            execSync(`git clone -b ${process.env.GIT_TAG} ${REPO_URL} tmp`);
            const remoteRev = execSync('git rev-parse HEAD', {"cwd": "./tmp"}).toString().trim();
            if (localRev !== remoteRev) {
                console.log(`New commit found: ${remoteRev}`);
                execSync('rm -rf orbs-lambda && mv tmp orbs-lambda');
                this.restart(newCommittee);
                localRev = remoteRev;
            } else execSync('rm -rf tmp');

            await new Promise(resolve => setTimeout(resolve, 60000));
        }
    }
}

dotenv.config({path: path.resolve(__dirname, `../${process.env.ENV_FILE ?? '.env'}`)});
const syncer = new Syncer('executor.js')
syncer.run().then()