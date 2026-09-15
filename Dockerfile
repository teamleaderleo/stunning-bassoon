FROM node:22-alpine

WORKDIR /app

COPY package.json ./
COPY src ./src
COPY fixtures ./fixtures
COPY web ./web

ENV PORT=3000
EXPOSE 3000

CMD ["npm", "start"]
