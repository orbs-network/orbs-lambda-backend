#!/bin/bash

docker login -u $DOCKER_HUB_LOGIN -p $DOCKER_HUB_PASSWORD

export VERSION=$(cat .version)

docker push orbsnetworkstaging/vm-lambda:$VERSION

if [[ $CIRCLE_BRANCH == "master" ]] ;
then
  docker tag orbsnetworkstaging/vm-lambda:$VERSION orbsnetworkstaging/vm-lambda:experimental
  docker push orbsnetworkstaging/vm-lambda:experimental
fi
