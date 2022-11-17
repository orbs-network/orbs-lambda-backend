import {readdirSync, statSync} from "fs";
import * as path from 'path';
import {Engine} from "./engine";
import dotenv from 'dotenv';
import * as _process from "process";
import {error, log} from "./utils";

// TODO: Executor class?

function getMatchingFiles(dirPath: string, arrayOfFiles: string[] = []) {
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

async function main() {
    process.on('message', async (guardians: {}) => {
        dotenv.config({path: path.resolve(__dirname, `../${_process.env.ENV_FILE ?? '.env'}`)});
        const tasksList = Object.fromEntries(
            getMatchingFiles(_process.env.PROJECTS_DIR!).map(f => [path.basename(path.dirname(f)), f]) // projectName: ProjectFile
        )

        const engine = new Engine(
            {
                'polygon': {"id": 137, "rpcUrl": _process.env.POLYGON_PROVIDER},
                'ethereum': {"id": 1, "rpcUrl": _process.env.ETHEREUM_PROVIDER},
                'bsc': {"id": 56, "rpcUrl": _process.env.BSC_PROVIDER},
                "goerli": {"id": 5, rpcUrl: _process.env.GOERLI_PROVIDER}
            },
            guardians,
            _process.env.SIGNER_URL)

        process.on('unhandledRejection', (reason, promise) => {
            error(`Unhandled Rejection at: ${promise}, reason: ${reason}`);
        });

        process.on('uncaughtException', function (err, origin) {
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
                log(`Still running ${engine.runningTasks} tasks:\n${runningTasks}Waiting for ${(new Date().getTime() - t) / 1000} seconds to finish...`);
                await new Promise(resolve => setTimeout(resolve, 3000));
            }
            process.exit();
        }));

        engine.run(tasksList);
    });
}


main().then().catch(e => error(e))
