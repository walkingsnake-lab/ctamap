FROM node:22-alpine

WORKDIR /app

COPY package.json ./
# Install all deps (including esbuild devDep) so we can build the bundle
RUN npm install

COPY . .
RUN npm run build

# Drop devDependencies after build to shrink the image
RUN npm prune --omit=dev

EXPOSE 3000

CMD ["node", "server.js"]
