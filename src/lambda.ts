import {REPO_URL} from "./constants";

export class Lambda {
    public projectName: string;
    public taskName: string;
    public type: string;
    public args: any;
    public fn: any;
    public isRunning: boolean;
    private githubUrl: string;
    public offset: number; // only for onInterval

    constructor(projectName, taskName, type, fn, args, offset?) {
        this.projectName = projectName;
        this.taskName = taskName;
        this.type = type;
        this.fn = fn;
        this.args = args;
        this.githubUrl = `${REPO_URL}/blob/master/projects/${projectName}/index.js`;
        this.isRunning = false;
        this.offset = offset;
    }
}