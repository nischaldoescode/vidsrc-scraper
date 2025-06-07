# Use official Node.js image with Chromium deps
FROM mcr.microsoft.com/playwright:focal

# Set working directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source files
COPY . .

# Expose port (match your app port)
EXPOSE 3000

# Start app
CMD ["npm", "start"]
