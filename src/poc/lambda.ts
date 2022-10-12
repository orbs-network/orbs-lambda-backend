export class Lambda {
    public projectName: string;
    public taskName: string;
    public type: string;

    constructor(projectName, taskName, type) {
        this.projectName = projectName;
        this.taskName = taskName;
        this.type = type;
    }
}