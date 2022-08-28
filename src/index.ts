import {outputFileSync} from "fs-extra"
async function main() {
    console.log("Running...")
    const myStatus = {
        "Error": "Human readable explanation of current error, field exists only if the status is erroneous.",
        "Status": "Human readable explanation of current status, field always exists.",
        "Timestamp": new Date().toISOString(),
        "Payload": {
            "Version": {
                "Semantic": "v1.3.1"
            },
            "CustomFieldsGoHere": 17,
            "MoreCustomFields": "any data type"
        },
        "config": {}
    }
    outputFileSync('./status/status.json', JSON.stringify(myStatus));
    await new Promise(resolve => setTimeout(resolve, 60000));
}

main().then().catch(e=>console.log(e))