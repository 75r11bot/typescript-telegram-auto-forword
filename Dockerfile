# Use the official Node.js image as the base image
FROM node:16

# Set the working directory
WORKDIR /usr/src/app

# Copy package.json and yarn.lock files to the working directory
COPY package*.json ./

# Install dependencies
RUN yarn install

# Copy the rest of the application files to the working directory
COPY . .

# Build the application
RUN yarn run build

# Expose the port the app runs on
EXPOSE 5000

# Command to run the application
CMD [ "node", "dist/main.js" ]
