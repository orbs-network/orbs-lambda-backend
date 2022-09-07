import {outputFileSync} from "fs-extra"
// import {execSync} from "child_process";

const myStatus = {
    "Error": "Human readable explanation of current error, field exists only if the status is erroneous.",
    "Status": "Human readable explanation of current status, field always exists.",
    "Timestamp": "",
    "Payload": {
        "Version": {
            "Semantic": "v1.3.1"
        },
        "CustomFieldsGoHere": 17,
        "MoreCustomFields": "any data type"
    },
    "config": {}
}

// let oldRevision = execSync('git rev-parse HEAD').toString().trim()

async function main() {
    while (true) {
        // console.log("Looking for Git changes...");
        // const newRevision = execSync('git rev-parse HEAD').toString().trim();
        // if (newRevision !== oldRevision) console.log("New commit found", newRevision);
        // oldRevision = newRevision;

        myStatus.Timestamp = new Date().toISOString();
        outputFileSync('./status/status.json', JSON.stringify(myStatus));
        await new Promise(resolve => setTimeout(resolve, 60000));
    }
}

main().then().catch(e=>console.log(e))