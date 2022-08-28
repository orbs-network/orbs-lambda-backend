import {storageHandler} from "./storageHandler";

class Lambda {
    private storage: any;
    public projectName: string;
    public taskName: string;

    constructor(projectName, taskName) {
        this.storage = new storageHandler();
        this.projectName = projectName;
        this.taskName = taskName;
    }
}