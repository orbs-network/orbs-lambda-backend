#!/bin/bash

npm run build
docker build -t orbsnetworkstaging/vm-lambda:$(cat .version) .
