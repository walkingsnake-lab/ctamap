FROM node:22-alpine

WORKDIR /app

# Install production dependencies only
COPY package.json ./
RUN npm install --omit=dev 2>/dev/null; true

# Copy the built app (run `npm run build` before deploying)
COPY . .

EXPOSE 3000

CMD ["node", "server.js"]
