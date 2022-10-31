import {resolve} from "path"
import {fork} from "child_process"
import {PROCESS_TIMEOUT} from "./constants";
import {log, error} from "./utils";

class Syncer {
    private children = {}
    private readonly program: any;

    constructor(executorPath) {
        this.program = resolve(executorPath);
        this.run()
    }

    run() {
        log("Starting executor instance...");
        const child = fork(this.program);
        if (child.pid) {
            this.children[child.pid] = Object.assign({'timestamp': new Date().getTime()}, child); // add spawn timestamp to child object
            const _this = this;
            child.on('exit', function (code) {
                log(`Shut down completed with exited code ${code}`);
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
}

// TODO: sync git and committee

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

new Syncer('executor.js')