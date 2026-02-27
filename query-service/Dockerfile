FROM node:18-alpine

WORKDIR /usr/src/app

COPY package*.json ./

RUN apk add --no-cache curl && npm install

COPY . .

EXPOSE 8081

CMD ["npm", "start"]
