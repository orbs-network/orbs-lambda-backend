export interface Config {
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
    statusJsonPath: string
}

export interface Status {
    "Status": string,
    "Timestamp": string,
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
        "humanUptime": string,
        "lastUpdateUTC": string,
        "config": Config
    },
    Error?: string
}