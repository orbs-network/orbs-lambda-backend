FROM node:16-alpine

ENV WORKDIR /opt/orbs

# standard working directory
WORKDIR ${WORKDIR}

RUN apk add --no-cache daemontools --repository http://dl-cdn.alpinelinux.org/alpine/edge/testing
RUN apk add --no-cache python3 make g++ git

# install your app
COPY package*.json ./
RUN npm install

COPY .version ./
COPY dist ./dist

COPY ./entrypoint.sh ${WORKDIR}/service

ENV NODE_ENV staging
COPY ./config_${NODE_ENV}.json ./

# install healthcheck based on status.json
COPY ./healthcheck.sh ./
COPY ./healthcheck.js ./

HEALTHCHECK CMD ${WORKDIR}/healthcheck.sh

# for debugging locally
CMD ${WORKDIR}/service