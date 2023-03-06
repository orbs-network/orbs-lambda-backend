import * as path from 'path';
import {Engine} from "./engine";
import {error, getMatchingFiles, log, debug} from "./utils";
import {
    MESSAGE_GET_STATUS,
    MESSAGE_START,
    MESSAGE_WRITE_STATUS,
    NETWORK_BSC,
    NETWORK_ETHEREUM, NETWORK_GOERLI,
    NETWORK_POLYGON
} from "./constants";
import Signer from "orbs-signer-client";
import process from "process";

let engine;
let ERRORS: string[] = [];

async function runEngine(config, guardians) {
    const tasksList = Object.fromEntries(
        getMatchingFiles(config.projectsDir, config.projectsPattern).map(f => [path.basename(path.dirname(f)), f]) // projectName: ProjectFile
    )

    const engine = new Engine(
        tasksList,
        {
            [NETWORK_POLYGON]: {"id": 137, "rpcUrl": config.polygonProvider, eip1559: true},
            [NETWORK_ETHEREUM]: {"id": 1, "rpcUrl": config.ethereumProvider, eip1559: true},
            [NETWORK_BSC]: {"id": 56, "rpcUrl": config.bscProvider, eip1559: false},
            [NETWORK_GOERLI]: {"id": 5, rpcUrl: config.goerliProvider, eip1559: true}
        },
        guardians,
        new Signer(config.SignerEndpoint),
        config)

    process.on('unhandledRejection', (reason: any, promise) => {
        const errMsg = `Unhandled Rejection: ${reason.stack}`;
        error(errMsg);
        ERRORS.push(errMsg)
    });

    process.on('uncaughtException', function (err, origin) {
        const errMsg = `Caught exception: ${err}\nException origin: ${origin}`;
        error(errMsg);
        ERRORS.push(errMsg);
    });

    ['SIGINT', 'SIGTERM', 'SIGQUIT'].forEach(signal => process.on(signal, async () => {
        log(`Engine received ${signal} signal`)
        engine.isShuttingDown = true;
        const t = new Date().getTime();
        while (engine.runningTasks) {
            let runningTasks: string[] = [];
            for (const project in engine.lambdas) {
                for (const lambda of engine.lambdas[project]) {
                    if (lambda.isRunning) runningTasks.push(`${project} ${lambda.taskName}`);
                }
            }
            log(`Still running ${engine.runningTasks} tasks:\n${runningTasks.join('\n')}Waiting for ${(new Date().getTime() - t) / 1000} seconds to finish...`);
            await new Promise(resolve => setTimeout(resolve, 3000));
        }
        process.exit();
    }));

    engine.run();
    return engine;
}

process.on('message', async (message: {type: string, payload: any}) => {
    switch(message.type) {
        case MESSAGE_START:
            log("Running Engine...")
            engine = await runEngine(message.payload.config, message.payload.committee);
            break;
        case MESSAGE_GET_STATUS:
            debug("RECEIVED MESSAGE_GET_STATUS")
            if (engine) {
                const status = await engine.generateState();
                debug(status)
                engine.status.errors = engine.status.errors.concat(ERRORS);
                process.send!({type: MESSAGE_WRITE_STATUS, payload: status});
                // clean up for next iteration
                engine.status.errors = [];
                ERRORS = [];
            }
            break;
        default:
            error(`Unsupported message type: ${message.type}`)
    }
});
