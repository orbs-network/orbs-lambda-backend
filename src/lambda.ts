export class Lambda {
    public projectName: string;
    public taskName: string;
    public type: string;
    public args: any;
    public fn: any;
    public isRunning: boolean;

    constructor(projectName, taskName, type, fn, args) {
        this.projectName = projectName;
        this.taskName = taskName;
        this.type = type;
        this.fn = fn;
        this.args = args;
        this.isRunning = false;
    }
}