# Use the official Node.js image as a base image
FROM node:16-alpine

# Create and change to the app directory
WORKDIR /usr/src/app

# Copy package.json and package-lock.json files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application files
COPY . .

# Expose the port the app runs on
EXPOSE 3000

# Command to run the app
CMD ["npm", "start"]
