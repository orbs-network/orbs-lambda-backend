#!/bin/sh +x

multilog_err=1
multilog_cmd="multilog s16777215 n10 /opt/orbs/logs"

while [[ "${multilog_err}" -ne "0" ]]; do
    sleep 1
    echo "lambda starting up.." | $multilog_cmd
    multilog_err=$?
done

echo "Running lambda.."

npm start -- $@ 2>&1 | $multilog_cmd 2>&1