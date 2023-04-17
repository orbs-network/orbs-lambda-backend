export interface Config {
    owlracleApikey: string;
    executorPath: string,
    gitTag: string,
    mgmtServiceUrl: string,
    projectsDir: string,
    projectsPattern: string,
    polygonProvider: string,
    ethereumProvider: string,
    bscProvider: string,
    goerliProvider: string,
    SignerEndpoint: string,
    statusJsonPath: string,
    BIUrl: string
}

export interface Status {
    "Status": string,
    "Timestamp": string,
    "humanUptime": string,
    "lastUpdateUTC": string,
    "Payload": {
        "Uptime": number,
        "MemoryUsage": {}
        "Version": {
            "Semantic": string
        },
        "ServiceLaunchTime": number,
        "EngineLaunchTime": number,
        "tasksCount": number,
        "isLeader": boolean,
        "leaderIndex": number,
        "leaderName": string,
        "tasks": {},
        "successTX": string[],
        "failTX": string[],
        "balance": {},
        myNode: {},
        "config": Config
    },
    Error?: string
}