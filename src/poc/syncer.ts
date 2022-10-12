import {resolve} from "path"
import {fork} from "child_process"

const program = resolve('executor.js');
const child = fork(program);

// TODO: sync git and committee

// setTimeout(() => {
//     child.kill();
// }, 20000);