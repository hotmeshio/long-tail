FROM node:20-slim
WORKDIR /app
COPY package.json tsconfig.json server.ts ./
RUN npm install && npx tsc
EXPOSE 9090
CMD ["node", "dist/server.js"]
