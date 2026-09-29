FROM node:20-alpine

WORKDIR /app

# Install dependencies first so they are cached between builds
COPY package*.json ./
RUN npm install --omit=dev

COPY . .

EXPOSE 3000

CMD ["node", "app.js"]
