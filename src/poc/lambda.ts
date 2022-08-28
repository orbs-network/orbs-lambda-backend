import {storageHandler} from "./storageHandler";

export class Lambda {
    public storage: storageHandler;
    public projectName: string;
    public taskName: string;
    public type: string;

    constructor(projectName, taskName, type) {
        this.storage = new storageHandler();
        this.projectName = projectName;
        this.taskName = taskName;
        this.type = type;
    }
}