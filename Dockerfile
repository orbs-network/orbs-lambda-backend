FROM node:16-alpine

# standard working directory
WORKDIR /opt/orbs

RUN apk add --no-cache python3 make g++

# install your app
COPY package*.json ./
RUN npm install

COPY dist ./dist

COPY ./entrypoint.sh /opt/orbs/service

# install healthcheck based on status.json
COPY ./healthcheck.sh ./
COPY ./healthcheck.js ./

RUN chmod a+x /opt/orbs/service /opt/orbs/healthcheck.sh
HEALTHCHECK CMD /opt/orbs/healthcheck.sh