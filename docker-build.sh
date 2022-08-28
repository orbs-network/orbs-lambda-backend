#!/bin/bash

npm run build
docker build -t orbsnetworkstaging/orbs-lambda-backend:$(cat .version) .
